# Databricks notebook source
"""
tools/aws_export.py

DynamoDB → S3 exporter with optional AWS Glue Data Catalog registration.

Designed for consumption by Databricks via S3 (CSV or NDJSON) or the
Glue metastore (Parquet-compatible table definition pointing to S3).

Usage:
    from tools.aws_export import DynamoToS3Exporter

    exporter = DynamoToS3Exporter()

    result = exporter.export_table_to_s3(
        table_name='medications',
        bucket='my-healthcare-exports',
        prefix='exports/medications/',   # optional, defaults to exports/<table>/
        fmt='csv',                       # 'csv' or 'ndjson'
        create_bucket=False,
    )
    # result: {'s3Uri': 's3://...', 'rows': 1234, 'sizeBytes': ..., 'format': 'csv'}

    glue_result = exporter.register_glue_table(
        database='healthcare',
        table_name='medications',
        s3_uri='s3://my-bucket/exports/medications/',
        fmt='csv',
        columns=[{'name': 'id', 'type': 'string'}, ...],
        create_database=True,
    )
"""

import csv
import io
import json
import os
from decimal import Decimal
from pathlib import Path


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _boto_kwargs():
    """Build shared boto3 constructor kwargs from env."""
    kwargs = {'region_name': os.getenv('AWS_REGION', 'us-east-1')}
    ak = os.getenv('AWS_ACCESS_KEY_ID')
    sk = os.getenv('AWS_SECRET_ACCESS_KEY')
    st = os.getenv('AWS_SESSION_TOKEN')
    if ak and sk:
        kwargs['aws_access_key_id'] = ak
        kwargs['aws_secret_access_key'] = sk
        if st:
            kwargs['aws_session_token'] = st
    endpoint = os.getenv('DYNAMODB_ENDPOINT')
    if endpoint:
        kwargs['endpoint_url'] = endpoint
    return kwargs


def _serialize(value):
    """Recursively convert DynamoDB/boto3 types to JSON-safe Python types."""
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    if isinstance(value, dict):
        return {k: _serialize(v) for k, v in value.items()}
    if isinstance(value, (list, set, frozenset)):
        return [_serialize(v) for v in value]
    return value


def _row_to_flat(item):
    """Flatten a DynamoDB item into a string-valued dict for CSV output."""
    flat = {}
    for k, v in item.items():
        sv = _serialize(v)
        flat[k] = json.dumps(sv) if isinstance(sv, (dict, list)) else ('' if sv is None else str(sv))
    return flat


# ---------------------------------------------------------------------------
# DynamoToS3Exporter
# ---------------------------------------------------------------------------

class DynamoToS3Exporter:
    """
    Exports DynamoDB tables to S3 as CSV or NDJSON, and optionally
    registers them in the AWS Glue Data Catalog for Databricks access.
    """

    SUPPORTED_FORMATS = ('csv', 'ndjson')

    def __init__(self):
        import boto3
        kw = _boto_kwargs()
        # DynamoDB uses the same endpoint override; S3 and Glue use default endpoints
        self._dynamodb = boto3.resource('dynamodb', **kw)
        self._dynamo_client = self._dynamodb.meta.client

        s3_kw = {k: v for k, v in kw.items() if k != 'endpoint_url'}
        self._s3 = boto3.client('s3', **s3_kw)
        self._glue = boto3.client('glue', **s3_kw)

    # -------------------------------------------------------------------------
    # DynamoDB scan
    # -------------------------------------------------------------------------

    def scan_table(self, table_name):
        """
        Full paginated scan of a DynamoDB table.
        Returns a generator of item dicts.
        """
        table = self._dynamodb.Table(table_name)
        last_key = None
        while True:
            kwargs = {}
            if last_key:
                kwargs['ExclusiveStartKey'] = last_key
            page = table.scan(**kwargs)
            for item in page.get('Items', []):
                yield _serialize(item)
            last_key = page.get('LastEvaluatedKey')
            if not last_key:
                break

    # -------------------------------------------------------------------------
    # S3 helpers
    # -------------------------------------------------------------------------

    def bucket_exists(self, bucket):
        from botocore.exceptions import ClientError
        try:
            self._s3.head_bucket(Bucket=bucket)
            return True
        except ClientError as exc:
            code = exc.response.get('Error', {}).get('Code', '')
            if code in ('404', 'NoSuchBucket'):
                return False
            raise

    def create_bucket(self, bucket):
        """Create an S3 bucket in the configured region."""
        region = os.getenv('AWS_REGION', 'us-east-1')
        if region == 'us-east-1':
            self._s3.create_bucket(Bucket=bucket)
        else:
            self._s3.create_bucket(
                Bucket=bucket,
                CreateBucketConfiguration={'LocationConstraint': region},
            )
        # Block all public access
        self._s3.put_public_access_block(
            Bucket=bucket,
            PublicAccessBlockConfiguration={
                'BlockPublicAcls': True,
                'IgnorePublicAcls': True,
                'BlockPublicPolicy': True,
                'RestrictPublicBuckets': True,
            },
        )
        print(f'[aws_export] Created S3 bucket "{bucket}".')

    def create_bucket_if_missing(self, bucket):
        """Create the bucket only when it does not already exist."""
        if not self.bucket_exists(bucket):
            self.create_bucket(bucket)
            return 'created'
        return 'exists'

    def list_buckets(self):
        """Return list of S3 bucket name strings."""
        resp = self._s3.list_buckets()
        return [b['Name'] for b in resp.get('Buckets', [])]

    def list_objects(self, bucket, prefix=''):
        """
        List objects in an S3 bucket.

        Returns a list of dicts:
            {key, size, lastModified (ISO string), etag}
        Paginates automatically; max 1 000 objects per page.
        """
        objects = []
        kwargs = {'Bucket': bucket}
        if prefix:
            kwargs['Prefix'] = prefix
        paginator = self._s3.get_paginator('list_objects_v2')
        for page in paginator.paginate(**kwargs):
            for obj in page.get('Contents', []):
                objects.append({
                    'key': obj['Key'],
                    'size': obj['Size'],
                    'lastModified': obj['LastModified'].isoformat(),
                    'etag': obj.get('ETag', '').strip('"'),
                })
        return objects

    def delete_bucket(self, bucket, force=False):
        """
        Delete an S3 bucket.

        If force=True, empties the bucket first (deletes all objects and
        delete-markers) before deleting the bucket itself.
        """
        if force:
            # Delete all object versions / delete-markers (handles versioned buckets)
            paginator = self._s3.get_paginator('list_object_versions')
            for page in paginator.paginate(Bucket=bucket):
                objects_to_delete = []
                for v in page.get('Versions', []):
                    objects_to_delete.append({'Key': v['Key'], 'VersionId': v['VersionId']})
                for m in page.get('DeleteMarkers', []):
                    objects_to_delete.append({'Key': m['Key'], 'VersionId': m['VersionId']})
                if objects_to_delete:
                    self._s3.delete_objects(Bucket=bucket, Delete={'Objects': objects_to_delete})
            # Also clear any un-versioned objects (non-versioned bucket)
            paginator2 = self._s3.get_paginator('list_objects_v2')
            for page in paginator2.paginate(Bucket=bucket):
                objects_to_delete = [{'Key': o['Key']} for o in page.get('Contents', [])]
                if objects_to_delete:
                    self._s3.delete_objects(Bucket=bucket, Delete={'Objects': objects_to_delete})
        self._s3.delete_bucket(Bucket=bucket)

    def generate_download_url(self, bucket, key, expires=3600):
        """Return a presigned GET URL for a single S3 object."""
        return self._s3.generate_presigned_url(
            'get_object',
            Params={'Bucket': bucket, 'Key': key},
            ExpiresIn=expires,
        )

    def upload_local_csv_to_s3(self, local_path, bucket, s3_key):
        """
        Upload a local CSV file to S3.

        Returns:
            {'s3Uri': 's3://bucket/key', 's3Bucket': bucket, 's3Key': s3_key, 'sizeBytes': int}
        """
        import os
        self._s3.upload_file(str(local_path), bucket, s3_key)
        size = os.path.getsize(str(local_path))
        s3_uri = f"s3://{bucket}/{s3_key}"
        print(f"[aws_export] Uploaded {local_path} → {s3_uri} ({size} bytes)")
        return {'s3Uri': s3_uri, 's3Bucket': bucket, 's3Key': s3_key, 'sizeBytes': size}

    # -------------------------------------------------------------------------
    # Export
    # -------------------------------------------------------------------------

    def export_table_to_s3(
        self,
        table_name,
        bucket,
        prefix=None,
        fmt='csv',
        create_bucket=False,
    ):
        """
        Scan DynamoDB table and upload to S3 as CSV or NDJSON.

        Returns:
            {
                's3Uri':     's3://bucket/prefix/table.csv',
                's3Bucket':  bucket,
                's3Key':     'exports/table/table.csv',
                'rows':      int,
                'sizeBytes': int,
                'format':    'csv' | 'ndjson',
                'tableName': table_name,
            }
        """
        fmt = fmt.lower()
        if fmt not in self.SUPPORTED_FORMATS:
            raise ValueError(f'Unsupported format "{fmt}". Choose: {self.SUPPORTED_FORMATS}')

        if prefix is None:
            prefix = f'exports/{table_name}/'
        if not prefix.endswith('/'):
            prefix += '/'

        ext = 'csv' if fmt == 'csv' else 'ndjson'
        s3_key = f'{prefix}{table_name}.{ext}'

        # ── ensure bucket ─────────────────────────────────────────────────
        if not self.bucket_exists(bucket):
            if not create_bucket:
                raise ValueError(
                    f'Bucket "{bucket}" does not exist. '
                    'Set createBucket=true to create it automatically.'
                )
            self.create_bucket(bucket)

        # ── scan + build payload ──────────────────────────────────────────
        print(f'[aws_export] Scanning DynamoDB table "{table_name}"...')
        rows = list(self.scan_table(table_name))
        row_count = len(rows)
        print(f'[aws_export] {row_count} rows scanned.')

        if fmt == 'csv':
            body = self._rows_to_csv(rows)
            content_type = 'text/csv'
        else:
            body = self._rows_to_ndjson(rows)
            content_type = 'application/x-ndjson'

        size_bytes = len(body.encode('utf-8'))

        # ── upload ────────────────────────────────────────────────────────
        print(f'[aws_export] Uploading to s3://{bucket}/{s3_key} ({size_bytes} bytes)...')
        self._s3.put_object(
            Bucket=bucket,
            Key=s3_key,
            Body=body.encode('utf-8'),
            ContentType=content_type,
        )
        print('[aws_export] Upload complete.')

        return {
            's3Uri': f's3://{bucket}/{s3_key}',
            's3Bucket': bucket,
            's3Key': s3_key,
            'rows': row_count,
            'sizeBytes': size_bytes,
            'format': fmt,
            'tableName': table_name,
        }

    # -------------------------------------------------------------------------
    # Format helpers
    # -------------------------------------------------------------------------

    @staticmethod
    def _rows_to_csv(rows):
        if not rows:
            return ''
        # Collect all column names preserving first-seen order
        all_keys = list(dict.fromkeys(k for row in rows for k in row.keys()))
        buf = io.StringIO()
        writer = csv.DictWriter(buf, fieldnames=all_keys, extrasaction='ignore', lineterminator='\n')
        writer.writeheader()
        for row in rows:
            writer.writerow(_row_to_flat(row))
        return buf.getvalue()

    @staticmethod
    def _rows_to_ndjson(rows):
        lines = []
        for row in rows:
            lines.append(json.dumps(_serialize(row), default=str))
        return '\n'.join(lines)

    # -------------------------------------------------------------------------
    # Glue Data Catalog registration
    # -------------------------------------------------------------------------

    def register_glue_table(
        self,
        database,
        table_name,
        s3_uri,
        fmt='csv',
        columns=None,
        create_database=True,
    ):
        """
        Register an S3 path in the AWS Glue Data Catalog so Databricks
        can query it via the Glue metastore.

        s3_uri   — 's3://bucket/prefix/' (must end with /)
        fmt      — 'csv' or 'ndjson'
        columns  — list of {'name': str, 'type': str} dicts.
                   If omitted, a single catch-all string column is used.
                   Run an export first then supply the schema.
        create_database — create the Glue database if it doesn't exist

        Returns:
            {'database': ..., 'tableName': ..., 's3Uri': ..., 'action': 'created'|'updated'}
        """
        from botocore.exceptions import ClientError

        fmt = fmt.lower()

        # ── ensure database ───────────────────────────────────────────────
        if create_database:
            try:
                self._glue.get_database(Name=database)
            except ClientError as exc:
                if exc.response['Error']['Code'] == 'EntityNotFoundException':
                    self._glue.create_database(
                        DatabaseInput={
                            'Name': database,
                            'Description': f'Healthcare data exported from DynamoDB ({database})',
                        }
                    )
                    print(f'[aws_export] Glue database "{database}" created.')
                else:
                    raise

        # ── build StorageDescriptor ───────────────────────────────────────
        if fmt == 'csv':
            serde_info = {
                'SerializationLibrary': 'org.apache.hadoop.hive.serde2.OpenCSVSerde',
                'Parameters': {'separatorChar': ',', 'quoteChar': '"', 'escapeChar': '\\'},
            }
            input_format = 'org.apache.hadoop.mapred.TextInputFormat'
            output_format = 'org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat'
            table_params = {'classification': 'csv', 'skip.header.line.count': '1'}
        else:  # ndjson
            serde_info = {
                'SerializationLibrary': 'org.openx.data.jsonserde.JsonSerDe',
                'Parameters': {'ignore.malformed.json': 'true'},
            }
            input_format = 'org.apache.hadoop.mapred.TextInputFormat'
            output_format = 'org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat'
            table_params = {'classification': 'json'}

        glue_columns = [
            {'Name': col['name'], 'Type': col.get('type', 'string')}
            for col in (columns or [])
        ]

        storage_descriptor = {
            'Location': s3_uri.rstrip('/') + '/',
            'InputFormat': input_format,
            'OutputFormat': output_format,
            'SerdeInfo': serde_info,
            'Columns': glue_columns,
            'Compressed': False,
            'StoredAsSubDirectories': False,
        }

        table_input = {
            'Name': table_name,
            'Description': f'DynamoDB export: {table_name} ({fmt})',
            'StorageDescriptor': storage_descriptor,
            'TableType': 'EXTERNAL_TABLE',
            'Parameters': table_params,
        }

        # ── create or update ──────────────────────────────────────────────
        action = 'updated'
        try:
            self._glue.get_table(DatabaseName=database, Name=table_name)
            self._glue.update_table(DatabaseName=database, TableInput=table_input)
            print(f'[aws_export] Glue table "{database}.{table_name}" updated.')
        except ClientError as exc:
            if exc.response['Error']['Code'] == 'EntityNotFoundException':
                self._glue.create_table(DatabaseName=database, TableInput=table_input)
                action = 'created'
                print(f'[aws_export] Glue table "{database}.{table_name}" created.')
            else:
                raise

        return {
            'database': database,
            'tableName': table_name,
            's3Uri': s3_uri,
            'format': fmt,
            'action': action,
        }

    # -------------------------------------------------------------------------
    # Glue database listing
    # -------------------------------------------------------------------------

    def list_glue_databases(self):
        """Return list of Glue database name strings."""
        resp = self._glue.get_databases()
        return [db['Name'] for db in resp.get('DatabaseList', [])]

    def list_glue_tables(self, database):
        """Return list of Glue table name strings for a database."""
        resp = self._glue.get_tables(DatabaseName=database)
        return [t['Name'] for t in resp.get('TableList', [])]
