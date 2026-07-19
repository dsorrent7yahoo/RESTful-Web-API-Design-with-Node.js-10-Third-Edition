"""
claims_store_manifest.py
Builds and stores a compact manifest for cleaned claims artifacts.
Publishes pipeline step status to SQS.
"""

import json
import os
from datetime import datetime, timezone

import boto3

from lambda_logger import LambdaTimer, get_logger, mark_warm

log = get_logger("claims_store_manifest")

BUCKET = os.getenv("STAGING_BUCKET", "dgs-glue-staging")
MANIFEST_PREFIX = os.getenv("CLAIMS_MANIFEST_PREFIX", "claims-manifest/")
REGION = os.getenv("AWS_REGION", "us-east-1")
SQS_QUEUE_URL = os.getenv(
    "SQS_QUEUE_URL",
    "https://sqs.us-east-1.amazonaws.com/005905648819/dgs-fhir-lambda-results",
)


def _s3():
    return boto3.client("s3", region_name=REGION)


def _sqs():
    return boto3.client("sqs", region_name=REGION)


def lambda_handler(event, context):
    event = event or {}
    request_id = getattr(context, "aws_request_id", "local")
    cold_start = mark_warm()

    session_id = event.get("session_id")
    bucket = event.get("bucket", BUCKET)
    source_key = (event.get("key") or event.get("clean_key") or "").strip()
    if not source_key:
        raise ValueError("claims_store_manifest requires 'key' (clean parquet key)")

    now_iso = datetime.now(timezone.utc).isoformat()
    run_stamp = now_iso.replace(":", "-")
    manifest_key = f"{MANIFEST_PREFIX.rstrip('/')}/manifest-{run_stamp}.json"

    with LambdaTimer(log, "claims_store_manifest", request_id):
        log.info(
            "writing claims manifest",
            extra={
                "bucket": bucket,
                "source_key": source_key,
                "manifest_key": manifest_key,
                "session_id": session_id,
                "cold_start": cold_start,
            },
        )

        source_uri = f"s3://{bucket}/{source_key}"
        manifest = {
            "session_id": session_id,
            "created_at": now_iso,
            "bucket": bucket,
            "artifacts": {
                "clean_claims_parquet": source_uri,
            },
            "step": "store_claims_manifest",
            "step_status": "SUCCEEDED",
        }

        body = json.dumps(manifest, indent=2).encode("utf-8")
        _s3().put_object(
            Bucket=bucket,
            Key=manifest_key,
            Body=body,
            ContentType="application/json",
        )

        result = {
            "statusCode": 200,
            "lambda": "claims_store_manifest",
            "step": "store_claims_manifest",
            "step_status": "SUCCEEDED",
            "session_id": session_id,
            "bucket": bucket,
            "key": manifest_key,
            "manifest_key": manifest_key,
            "source_key": source_key,
            "timestamp": now_iso,
        }

        try:
            _sqs().send_message(
                QueueUrl=SQS_QUEUE_URL,
                MessageBody=json.dumps(result),
                MessageAttributes={
                    "lambda": {
                        "StringValue": "claims_store_manifest",
                        "DataType": "String",
                    }
                },
            )
        except Exception:
            log.warning("SQS publish failed", exc_info=True)

        return result


if __name__ == "__main__":
    lambda_handler(
        {
            "session_id": "local-session",
            "bucket": BUCKET,
            "key": "claims-parquet/claims-sample.parquet",
        },
        None,
    )
