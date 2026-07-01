# Databricks notebook source
"""
claims_cleaner.py
Cleans a claims CSV from S3, writes Parquet (Snappy), registers in Glue, publishes to SQS.
Emits structured JSON logs for CloudWatch Insights.
"""

import io
import json
import os
from datetime import datetime, timezone

import boto3
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

from lambda_logger import LambdaTimer, get_logger, mark_warm

log = get_logger("claims_cleaner")

BUCKET        = os.getenv("STAGING_BUCKET", "dgs-glue-staging")
CLEAN_PREFIX  = os.getenv("CLEAN_PREFIX",   "claims-parquet/")
GLUE_DB       = os.getenv("GLUE_DATABASE",  "fhir-table-db")
GLUE_TABLE    = os.getenv("GLUE_TABLE",     "claims_clean")
REGION        = os.getenv("AWS_REGION",     "us-east-1")
SQS_QUEUE_URL = os.getenv("SQS_QUEUE_URL",
    "https://sqs.us-east-1.amazonaws.com/005905648819/dgs-fhir-lambda-results")

_INPUT_FMT  = "org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat"
_OUTPUT_FMT = "org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat"
_SERDE      = "org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe"

_STRING_COLS = [
    "claim_id", "patient_id", "patient_name", "service_date",
    "status", "claim_type", "use", "provider_id", "provider_name",
    "diagnosis_code", "diagnosis_description",
    "procedure_code", "procedure_description",
    "currency", "insurance_member_id", "priority",
]
_FLOAT_COLS = ["unit_price", "net_amount"]
_INT_COLS   = ["quantity"]

_GLUE_COLS = [
    {"Name": "claim_id",              "Type": "string"},
    {"Name": "patient_id",            "Type": "string"},
    {"Name": "patient_name",          "Type": "string"},
    {"Name": "service_date",          "Type": "date"},
    {"Name": "status",                "Type": "string"},
    {"Name": "claim_type",            "Type": "string"},
    {"Name": "use",                   "Type": "string"},
    {"Name": "provider_id",           "Type": "string"},
    {"Name": "provider_name",         "Type": "string"},
    {"Name": "diagnosis_code",        "Type": "string"},
    {"Name": "diagnosis_description", "Type": "string"},
    {"Name": "procedure_code",        "Type": "string"},
    {"Name": "procedure_description", "Type": "string"},
    {"Name": "unit_price",            "Type": "double"},
    {"Name": "quantity",              "Type": "int"},
    {"Name": "net_amount",            "Type": "double"},
    {"Name": "currency",              "Type": "string"},
    {"Name": "insurance_member_id",   "Type": "string"},
    {"Name": "priority",              "Type": "string"},
]

_SCHEMA = pa.schema([
    pa.field("claim_id",              pa.string()),
    pa.field("patient_id",            pa.string()),
    pa.field("patient_name",          pa.string()),
    pa.field("service_date",          pa.date32()),
    pa.field("status",                pa.string()),
    pa.field("claim_type",            pa.string()),
    pa.field("use",                   pa.string()),
    pa.field("provider_id",           pa.string()),
    pa.field("provider_name",         pa.string()),
    pa.field("diagnosis_code",        pa.string()),
    pa.field("diagnosis_description", pa.string()),
    pa.field("procedure_code",        pa.string()),
    pa.field("procedure_description", pa.string()),
    pa.field("unit_price",            pa.float64()),
    pa.field("quantity",              pa.int32()),
    pa.field("net_amount",            pa.float64()),
    pa.field("currency",              pa.string()),
    pa.field("insurance_member_id",   pa.string()),
    pa.field("priority",              pa.string()),
])


def _clean(df, request_id):
    report = {"original_rows": len(df)}
    log.info("cleaning start", extra={"request_id": request_id, "original_rows": len(df)})

    # 1. Strip whitespace
    for col in _STRING_COLS:
        if col in df.columns:
            df[col] = df[col].astype(str).str.strip()

    # 2. Normalise case on categoricals
    for col in ["status", "claim_type", "use", "priority"]:
        if col in df.columns:
            df[col] = df[col].str.lower()
    if "currency" in df.columns:
        df["currency"] = df["currency"].str.upper()

    # 3. Drop blank / null service_date
    before = len(df)
    df = df[df["service_date"].notna() & (df["service_date"] != "") & (df["service_date"] != "nan")].copy()
    report["dropped_missing_date"] = before - len(df)
    log.info("step: drop missing date",
             extra={"request_id": request_id, "dropped": report["dropped_missing_date"]})

    # 4. Coerce numerics
    for col in _FLOAT_COLS:
        df[col] = pd.to_numeric(df[col], errors="coerce")
    for col in _INT_COLS:
        df[col] = pd.to_numeric(df[col], errors="coerce")
    before = len(df)
    df = df.dropna(subset=_FLOAT_COLS + _INT_COLS)
    report["dropped_invalid_numerics"] = before - len(df)
    log.info("step: coerce numerics",
             extra={"request_id": request_id, "dropped": report["dropped_invalid_numerics"]})

    # 5. Drop quantity <= 0
    before = len(df)
    df = df[df["quantity"] > 0]
    report["dropped_non_positive_qty"] = before - len(df)

    # 6. Drop duplicate claim_ids
    before = len(df)
    df = df.drop_duplicates(subset=["claim_id"], keep="first")
    report["dropped_duplicate_claims"] = before - len(df)
    if report["dropped_duplicate_claims"] > 0:
        log.warning("duplicate claim_ids found",
                    extra={"request_id": request_id,
                           "count": report["dropped_duplicate_claims"]})

    # 7. Drop missing required code fields
    before = len(df)
    for col in ["claim_id", "diagnosis_code", "procedure_code"]:
        df = df[df[col].notna() & (df[col] != "") & (df[col] != "nan")]
    report["dropped_missing_codes"] = before - len(df)

    # 8. Validate currency is 3-letter uppercase; correct bad values
    if "currency" in df.columns:
        bad = ~df["currency"].str.match(r"^[A-Z]{3}$", na=False)
        report["corrected_currency"] = int(bad.sum())
        df.loc[bad, "currency"] = "USD"
        if report["corrected_currency"] > 0:
            log.warning("invalid currency codes corrected",
                        extra={"request_id": request_id, "count": report["corrected_currency"]})

    # 9. Math check: flag net_amount vs unit_price * quantity mismatch
    df["_exp"] = df["unit_price"] * df["quantity"]
    df["_err"] = ((df["net_amount"] - df["_exp"]).abs() / df["_exp"].clip(lower=0.01))
    report["rows_amount_mismatch"] = int((df["_err"] > 0.01).sum())
    if report["rows_amount_mismatch"] > 0:
        log.warning("net_amount/unit_price mismatch detected",
                    extra={"request_id": request_id, "count": report["rows_amount_mismatch"]})
    df = df.drop(columns=["_exp", "_err"])

    # 10. Re-parse service_date to validate and normalise as ISO string
    df["service_date"] = pd.to_datetime(df["service_date"], errors="coerce").dt.normalize()
    before = len(df)
    df = df[df["service_date"].notna()]
    report["dropped_invalid_dates"] = before - len(df)

    report["clean_rows"] = len(df)
    log.info("cleaning complete",
             extra={"request_id": request_id, "clean_rows": report["clean_rows"],
                    "quality_report": report})
    return df.reset_index(drop=True), report


def _to_parquet(df):
    col_order = [f.name for f in _SCHEMA]
    df = df[[c for c in col_order if c in df.columns]]
    df["quantity"] = df["quantity"].astype(int)
    table = pa.Table.from_pandas(df, schema=_SCHEMA, preserve_index=False)
    buf = io.BytesIO()
    pq.write_table(table, buf, compression="snappy")
    return buf.getvalue()


def _row_hash(row: dict) -> str:
    """SHA-256 hash of every field in the row, order-independent.

    Used for full-row deduplication: if two rows produce the same hash
    every field value is identical, so the row is a duplicate regardless
    of how it arrived (re-generated batch, re-upload, etc.).
    """
    import hashlib
    canonical = "|".join(str(row.get(f, "")) for f in sorted(row.keys()))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _load_existing_row_hashes(s3_client, bucket, prefix, request_id):
    """SELECT * (as hashes) FROM all existing Parquet files in the prefix.

    Reads every row from every Parquet file already stored in the prefix
    and returns the set of their SHA-256 row hashes.  Any incoming row
    whose hash matches is a full duplicate and will be skipped.
    """
    existing = set()
    try:
        resp = s3_client.list_objects_v2(Bucket=bucket, Prefix=prefix)
        keys = [o["Key"] for o in resp.get("Contents", []) if o["Key"].endswith(".parquet")]
        if keys:
            log.info("scanning existing parquet files for full-row dedup",
                     extra={"request_id": request_id, "files": len(keys)})
        for pkey in keys:
            try:
                raw = s3_client.get_object(Bucket=bucket, Key=pkey)["Body"].read()
                tbl = pq.read_table(io.BytesIO(raw))
                df_existing = tbl.to_pandas().astype(str)
                for rec in df_existing.to_dict(orient="records"):
                    existing.add(_row_hash(rec))
            except Exception as exc:
                log.warning("could not read parquet for full-row dedup",
                            extra={"request_id": request_id, "key": pkey, "error": str(exc)})
    except Exception as exc:
        log.warning("could not list parquet prefix for dedup",
                    extra={"request_id": request_id, "error": str(exc)})
    return existing


def _register_glue(bucket, parquet_prefix, request_id):
    glue = boto3.client("glue", region_name=REGION)
    table_input = {
        "Name": GLUE_TABLE,
        "StorageDescriptor": {
            "Columns":      _GLUE_COLS,
            "Location":     f"s3://{bucket}/{parquet_prefix}",
            "InputFormat":  _INPUT_FMT,
            "OutputFormat": _OUTPUT_FMT,
            "SerdeInfo": {
                "SerializationLibrary": _SERDE,
                "Parameters": {"serialization.format": "1"},
            },
            "Parameters": {"classification": "parquet", "compressionType": "snappy"},
        },
        "TableType": "EXTERNAL_TABLE",
        "Parameters": {"classification": "parquet", "compressionType": "snappy",
                       "EXTERNAL": "TRUE"},
    }
    try:
        glue.create_table(DatabaseName=GLUE_DB, TableInput=table_input)
        log.info("Glue table created",
                 extra={"request_id": request_id, "db": GLUE_DB, "table": GLUE_TABLE})
    except glue.exceptions.AlreadyExistsException:
        glue.update_table(DatabaseName=GLUE_DB, TableInput=table_input)
        log.info("Glue table updated",
                 extra={"request_id": request_id, "db": GLUE_DB, "table": GLUE_TABLE})


def lambda_handler(event, context):
    request_id = getattr(context, "aws_request_id", "local")
    cold_start  = mark_warm()

    with LambdaTimer(log, "claims_cleaner", request_id):
        log.info("invoked",
                 extra={"event_keys": list(event.keys()), "cold_start": cold_start,
                        "request_id": request_id})

        if "Records" in event:
            rec    = event["Records"][0]["s3"]
            bucket = rec["bucket"]["name"]
            key    = rec["object"]["key"]
        else:
            bucket = event.get("bucket", BUCKET)
            key    = event.get("key", "").strip()

        if not key:
            raise ValueError("No S3 key provided in event")

        log.info("reading source CSV",
                 extra={"request_id": request_id, "bucket": bucket, "key": key})
        s3  = boto3.client("s3", region_name=REGION)
        raw = s3.get_object(Bucket=bucket, Key=key)["Body"].read()
        df  = pd.read_csv(io.BytesIO(raw), dtype=str)

        df_clean, report = _clean(df, request_id)

        # Full-row dedup: compare every field of every new row against every
        # row already stored in the Parquet prefix.  A row is skipped only if
        # ALL its field values match an existing stored row — safe for real
        # patient data where names/dates must be an exact match.
        existing_hashes = _load_existing_row_hashes(s3, bucket, CLEAN_PREFIX, request_id)
        if existing_hashes:
            before_dedup = len(df_clean)
            mask = df_clean.astype(str).apply(
                lambda row: _row_hash(row.to_dict()) not in existing_hashes, axis=1
            )
            df_clean = df_clean[mask].reset_index(drop=True)
            report["skipped_duplicate_rows"] = before_dedup - len(df_clean)
            if report["skipped_duplicate_rows"] > 0:
                log.info("skipped full-row duplicates already in catalog",
                         extra={"request_id": request_id,
                                "skipped": report["skipped_duplicate_rows"]})
        else:
            report["skipped_duplicate_rows"] = 0

        date_part     = key.split("/")[-1].replace(".csv", "")
        parquet_key   = f"{CLEAN_PREFIX}{date_part}.parquet"
        parquet_bytes = _to_parquet(df_clean)

        s3.put_object(Bucket=bucket, Key=parquet_key, Body=parquet_bytes,
                      ContentType="application/octet-stream")
        log.info("Parquet written to S3",
                 extra={"request_id": request_id, "key": parquet_key,
                        "size_bytes": len(parquet_bytes), "compression": "snappy"})

        _register_glue(bucket, CLEAN_PREFIX, request_id)

        result = {
            "statusCode":     200,
            "lambda":         "claims_cleaner",
            "source_key":     key,
            "bucket":         bucket,
            "key":            parquet_key,
            "filename":       parquet_key.split("/")[-1],
            "size_bytes":     len(parquet_bytes),
            "glue_database":  GLUE_DB,
            "glue_table":     GLUE_TABLE,
            "quality_report": report,
            "timestamp":      datetime.now(timezone.utc).date().isoformat(),
        }

        try:
            boto3.client("sqs", region_name=REGION).send_message(
                QueueUrl=SQS_QUEUE_URL,
                MessageBody=json.dumps(result),
                MessageAttributes={
                    "lambda": {"StringValue": "claims_cleaner", "DataType": "String"},
                },
            )
            log.info("SQS message sent", extra={"request_id": request_id})
        except Exception:
            log.warning("SQS publish failed", exc_info=True,
                        extra={"request_id": request_id})

        return result


if __name__ == "__main__":
    lambda_handler({"bucket": "dgs-glue-staging", "key": "claims/claims-2026-06-23.csv"}, None)
