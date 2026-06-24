import csv
import importlib
import io
import os
import sys

import boto3
from flask import Blueprint, jsonify, request

from utils.jwt_utils import jwt_required

claims_bp = Blueprint("claims", __name__)

BUCKET        = os.getenv("STAGING_BUCKET", "dgs-glue-staging")
CLAIMS_PREFIX = os.getenv("CLAIMS_PREFIX",  "claims/")
REGION        = os.getenv("AWS_REGION",     "us-east-1")


@claims_bp.post("/claims/generate")
@jwt_required
def generate_claims():
    """Run the synthetic_fhir_claims lambda handler in-process."""
    lambda_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "lambdas"))
    if lambda_dir not in sys.path:
        sys.path.insert(0, lambda_dir)
    import synthetic_fhir_claims as _mod
    importlib.reload(_mod)
    result = _mod.lambda_handler({}, None)
    return jsonify(result)


@claims_bp.get("/claims/files")
@jwt_required
def list_claims_files():
    """List CSV files under the claims/ prefix in the staging bucket."""
    s3   = boto3.client("s3", region_name=REGION)
    resp = s3.list_objects_v2(Bucket=BUCKET, Prefix=CLAIMS_PREFIX)
    files = []
    for obj in resp.get("Contents", []):
        key = obj["Key"]
        if key.endswith(".csv"):
            files.append({
                "key":          key,
                "name":         key.split("/")[-1],
                "size":         obj["Size"],
                "lastModified": obj["LastModified"].isoformat(),
            })
    files.sort(key=lambda f: f["lastModified"], reverse=True)
    return jsonify({"files": files, "bucket": BUCKET})


@claims_bp.get("/claims/file")
@jwt_required
def get_claims_file():
    """Return CSV rows as JSON for a given S3 key."""
    key = request.args.get("key", "").strip()
    if not key:
        return jsonify({"status": "error", "message": "key is required"}), 400
    s3  = boto3.client("s3", region_name=REGION)
    obj = s3.get_object(Bucket=BUCKET, Key=key)
    text   = obj["Body"].read().decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))
    rows   = list(reader)
    return jsonify({"key": key, "rows": rows, "count": len(rows)})
