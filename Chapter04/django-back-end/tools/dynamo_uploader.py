"""
tools/dynamo_uploader.py

Reusable DynamoDB CSV uploader — Python equivalent of dynamodb-uploader/index.js.

Usage:
    from tools.dynamo_uploader import DynamoUploader, UploadCancelledError

    uploader = DynamoUploader()

    result = uploader.upload(
        table_name='my-table',
        csv_path='/absolute/path/to/data.csv',   # OR csv_content='<csv string>'
        source_label='my-data.csv',

        # Transform each CSV row into a DynamoDB item.
        # Default: uses all columns as-is, adds a generated 'id' field.
        row_to_item=lambda row, index: {'id': f'row-{index}', **row},

        # Called when the target table already exists.
        # Return True  → delete existing table and re-upload.
        # Return False → cancel upload (no changes made).
        # Default: raises UploadCancelledError.
        on_table_exists=lambda table_name: False,

        batch_size=25,
        key_attribute_name='id',
        key_attribute_type='S',
    )
    # result: {'imported': N, 'source': '...', 'tableName': '...'}
"""

import csv
import io
import os
from pathlib import Path


# ---------------------------------------------------------------------------
# Error types
# ---------------------------------------------------------------------------

class UploadCancelledError(Exception):
    def __init__(self, table_name):
        super().__init__(
            f'Upload cancelled — table "{table_name}" already exists '
            'and replacement was not confirmed.'
        )
        self.table_name = table_name


class TableExistsError(Exception):
    def __init__(self, table_name):
        super().__init__(f'Table "{table_name}" already exists.')
        self.table_name = table_name


# ---------------------------------------------------------------------------
# DynamoUploader
# ---------------------------------------------------------------------------

class DynamoUploader:
    """
    Reusable DynamoDB CSV uploader.

    Constructor kwargs (all optional — fall back to env vars):
        region          AWS region  (AWS_REGION, default us-east-1)
        access_key_id   (AWS_ACCESS_KEY_ID)
        secret_key      (AWS_SECRET_ACCESS_KEY)
        session_token   (AWS_SESSION_TOKEN)
        endpoint        Local DynamoDB endpoint (DYNAMODB_ENDPOINT)
    """

    def __init__(self, **kwargs):
        import boto3

        boto_kwargs = {
            'region_name': kwargs.get('region') or os.getenv('AWS_REGION', 'us-east-1'),
        }

        access_key = kwargs.get('access_key_id') or os.getenv('AWS_ACCESS_KEY_ID')
        secret_key = kwargs.get('secret_key') or os.getenv('AWS_SECRET_ACCESS_KEY')
        session_token = kwargs.get('session_token') or os.getenv('AWS_SESSION_TOKEN')

        if access_key and secret_key:
            boto_kwargs['aws_access_key_id'] = access_key
            boto_kwargs['aws_secret_access_key'] = secret_key
            if session_token:
                boto_kwargs['aws_session_token'] = session_token

        endpoint = kwargs.get('endpoint') or os.getenv('DYNAMODB_ENDPOINT')
        if endpoint:
            boto_kwargs['endpoint_url'] = endpoint

        self._resource = boto3.resource('dynamodb', **boto_kwargs)
        self._client = self._resource.meta.client

    # -------------------------------------------------------------------------
    # Table management
    # -------------------------------------------------------------------------

    def table_exists(self, table_name):
        """Return True if the table exists, False if not."""
        from botocore.exceptions import ClientError
        try:
            self._client.describe_table(TableName=table_name)
            return True
        except ClientError as exc:
            if exc.response.get('Error', {}).get('Code') == 'ResourceNotFoundException':
                return False
            raise

    def create_table(self, table_name, key_attribute_name='id', key_attribute_type='S'):
        """Create the table if it does not already exist, then wait until ACTIVE."""
        if not self.table_exists(table_name):
            self._client.create_table(
                TableName=table_name,
                AttributeDefinitions=[
                    {'AttributeName': key_attribute_name, 'AttributeType': key_attribute_type}
                ],
                KeySchema=[
                    {'AttributeName': key_attribute_name, 'KeyType': 'HASH'}
                ],
                BillingMode='PAY_PER_REQUEST',
            )
            waiter = self._client.get_waiter('table_exists')
            waiter.wait(TableName=table_name)
            print(f'[dynamo_uploader] Table "{table_name}" created.')

    def recreate_table(self, table_name, key_attribute_name='id', key_attribute_type='S'):
        """Delete and recreate the table, then wait until ACTIVE."""
        if self.table_exists(table_name):
            print(f'[dynamo_uploader] Deleting existing table "{table_name}"...')
            self._client.delete_table(TableName=table_name)
            waiter = self._client.get_waiter('table_not_exists')
            waiter.wait(TableName=table_name)
            print(f'[dynamo_uploader] Table "{table_name}" deleted.')
        self.create_table(table_name, key_attribute_name, key_attribute_type)

    # -------------------------------------------------------------------------
    # CSV parsing
    # -------------------------------------------------------------------------

    @staticmethod
    def parse_csv_file(csv_path):
        """Parse a CSV file by absolute path; return list of row dicts."""
        with open(csv_path, newline='', encoding='utf-8-sig') as fh:
            reader = csv.DictReader(fh)
            return [
                {k.strip(): (v.strip() if v else v) for k, v in row.items()}
                for row in reader
            ]

    @staticmethod
    def parse_csv_content(csv_content):
        """Parse CSV from a string; return list of row dicts."""
        fh = io.StringIO(csv_content)
        reader = csv.DictReader(fh)
        return [
            {k.strip(): (v.strip() if v else v) for k, v in row.items()}
            for row in reader
        ]

    # -------------------------------------------------------------------------
    # Batch write
    # -------------------------------------------------------------------------

    def _batch_write(self, items, table_name, batch_size=25):
        """Write items to DynamoDB in batches of up to batch_size (max 25)."""
        table = self._resource.Table(table_name)
        for i in range(0, len(items), batch_size):
            batch = items[i:i + batch_size]
            with table.batch_writer() as writer:
                for item in batch:
                    writer.put_item(Item=item)

    # -------------------------------------------------------------------------
    # Default row transformer
    # -------------------------------------------------------------------------

    @staticmethod
    def _default_row_to_item(row, index):
        """
        Build a DynamoDB item from a raw CSV row dict.
        Keys are lower-cased; numeric strings are coerced to numbers.
        A deterministic 'id' is generated from the first three values + index.
        """
        item = {}
        for key, raw in (row or {}).items():
            norm_key = str(key or '').strip().lower()
            if not norm_key:
                continue
            if raw is None:
                item[norm_key] = None
                continue
            text = str(raw).strip()
            if not text:
                item[norm_key] = None
            else:
                try:
                    item[norm_key] = float(text) if '.' in text else int(text)
                except ValueError:
                    item[norm_key] = text

        if not item.get('id'):
            seed = '-'.join(
                str(item[k]) for k in list(item.keys())[:3]
                if item.get(k) is not None
            )
            item['id'] = f'{seed or "row"}-{index}'

        return item

    # -------------------------------------------------------------------------
    # Main upload entry point
    # -------------------------------------------------------------------------

    def upload(
        self,
        table_name,
        csv_path=None,
        csv_content=None,
        source_label=None,
        row_to_item=None,
        on_table_exists=None,
        batch_size=25,
        key_attribute_name='id',
        key_attribute_type='S',
    ):
        """
        Upload a CSV file or string into a DynamoDB table.

        Returns: {'imported': int, 'source': str, 'tableName': str}
        Raises UploadCancelledError if table exists and on_table_exists returns False.
        """
        if not table_name:
            raise ValueError('[dynamo_uploader] table_name is required.')
        if not csv_path and not csv_content:
            raise ValueError('[dynamo_uploader] Either csv_path or csv_content is required.')
        if csv_path and not Path(str(csv_path)).is_absolute():
            raise ValueError(f'[dynamo_uploader] csv_path must be an absolute path. Got: {csv_path}')

        # ── table-exists check ────────────────────────────────────────────
        exists = self.table_exists(table_name)
        if exists:
            should_replace = False
            if callable(on_table_exists):
                should_replace = bool(on_table_exists(table_name))
            if not should_replace:
                raise UploadCancelledError(table_name)
            self.recreate_table(table_name, key_attribute_name, key_attribute_type)
        else:
            self.create_table(table_name, key_attribute_name, key_attribute_type)

        # ── parse CSV ─────────────────────────────────────────────────────
        source = source_label or csv_path or 'uploaded-content'
        if csv_content:
            raw_rows = self.parse_csv_content(csv_content)
        else:
            if not Path(str(csv_path)).exists():
                raise FileNotFoundError(f'CSV file not found: {csv_path}')
            raw_rows = self.parse_csv_file(csv_path)

        # ── transform rows ────────────────────────────────────────────────
        transformer = row_to_item if callable(row_to_item) else self._default_row_to_item
        items = [transformer(row, i) for i, row in enumerate(raw_rows)]

        # ── batch write ───────────────────────────────────────────────────
        print(f'[dynamo_uploader] Writing {len(items)} items to "{table_name}"...')
        self._batch_write(items, table_name, batch_size)
        print(f'[dynamo_uploader] Done. {len(items)} items written.')

        return {'imported': len(items), 'source': str(source), 'tableName': table_name}
