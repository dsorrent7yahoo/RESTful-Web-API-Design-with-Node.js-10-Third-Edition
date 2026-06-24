"""
Lambda 2: csv_cleaner.py
-------------------------
Triggered by an S3 ObjectCreated event on the staging bucket (dgs-glue-staging).
For every CSV file landing under claims/ (or configurable PREFIX_FILTER):

  1. Download the raw CSV from S3.
  2. Remove any row where at least one field is null, empty, or whitespace-only.
  3. Trim leading/trailing whitespace from every field value (normalises
     extra spaces introduced around commas).
  4. Write the cleaned file back to S3 under cleaned/ with the same filename.
  5. Return a summary of rows removed and written.

Environment variables
---------------------
PREFIX_FILTER   : Only process keys whose prefix matches (default: claims/)
CLEANED_PREFIX  : Output key prefix (default: cleaned/)
AWS_REGION      : AWS region (default: us-east-1)
"""

import os
import io
import csv
import json
import logging
import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

PREFIX_FILTER   = os.environ.get("PREFIX_FILTER",   "claims/")
CLEANED_PREFIX  = os.environ.get("CLEANED_PREFIX",  "cleaned/")
AWS_REGION      = os.environ.get("AWS_REGION",      "us-east-1")


def clean_csv(raw_bytes: bytes) -> tuple[list[dict], int, int]:
    """
    Parse raw CSV bytes, strip whitespace from every cell, and drop rows
    that contain at least one empty field.

    Returns (clean_rows, total_input_rows, dropped_rows).
    """
    text    = raw_bytes.decode("utf-8", errors="replace")
    reader  = csv.DictReader(io.StringIO(text))
    headers = reader.fieldnames or []

    total_input = 0
    clean_rows  = []

    for row in reader:
        total_input += 1

        # Trim whitespace from every value
        trimmed = {k: (v.strip() if isinstance(v, str) else v) for k, v in row.items()}

        # Drop row if any field is empty after trimming
        has_empty = any(trimmed.get(h, "") == "" for h in headers)
        if has_empty:
            logger.debug("Dropping row %d — empty field(s): %s", total_input, trimmed)
            continue

        clean_rows.append(trimmed)

    dropped = total_input - len(clean_rows)
    return clean_rows, headers, total_input, dropped


def lambda_handler(event, context):
    s3 = boto3.client("s3", region_name=AWS_REGION)

    results = []

    for record in event.get("Records", []):
        bucket = record["s3"]["bucket"]["name"]
        key    = record["s3"]["object"]["key"]

        # Only process files under the configured prefix
        if not key.startswith(PREFIX_FILTER):
            logger.info("Skipping %s (not under %s)", key, PREFIX_FILTER)
            continue

        logger.info("Processing s3://%s/%s", bucket, key)

        # Download
        obj       = s3.get_object(Bucket=bucket, Key=key)
        raw_bytes = obj["Body"].read()

        # Clean
        clean_rows, headers, total_input, dropped = clean_csv(raw_bytes)

        if not clean_rows:
            logger.warning("No clean rows remain in %s — skipping write", key)
            results.append({
                "source_key":  key,
                "total_input": total_input,
                "dropped":     dropped,
                "written":     0,
                "status":      "skipped_empty",
            })
            continue

        # Serialise cleaned rows back to CSV
        buf    = io.StringIO()
        writer = csv.DictWriter(buf, fieldnames=headers)
        writer.writeheader()
        writer.writerows(clean_rows)
        clean_bytes = buf.getvalue().encode("utf-8")

        # Build output key: replace leading PREFIX_FILTER with CLEANED_PREFIX
        filename    = key[len(PREFIX_FILTER):]
        cleaned_key = CLEANED_PREFIX + filename

        s3.put_object(
            Bucket=bucket,
            Key=cleaned_key,
            Body=clean_bytes,
            ContentType="text/csv",
            Metadata={
                "cleaner":       "csv_cleaner_lambda",
                "source_key":    key,
                "rows_input":    str(total_input),
                "rows_dropped":  str(dropped),
                "rows_written":  str(len(clean_rows)),
            },
        )

        logger.info(
            "Cleaned %s -> %s | input=%d dropped=%d written=%d",
            key, cleaned_key, total_input, dropped, len(clean_rows),
        )

        results.append({
            "source_key":   key,
            "cleaned_key":  cleaned_key,
            "total_input":  total_input,
            "dropped":      dropped,
            "written":      len(clean_rows),
            "status":       "ok",
        })

    return {
        "statusCode": 200,
        "body": json.dumps({"processed": len(results), "results": results}),
    }
