import csv
import importlib
import io
import os
import sys

import boto3
from flask import Blueprint, jsonify, request

from utils.jwt_utils import jwt_required

claims_bp = Blueprint("claims", __name__)

BUCKET         = os.getenv("STAGING_BUCKET",  "dgs-glue-staging")
CLAIMS_PREFIX  = os.getenv("CLAIMS_PREFIX",   "claims/")
PARQUET_PREFIX = os.getenv("CLEAN_PREFIX",    "claims-parquet/")
REGION         = os.getenv("AWS_REGION",      "us-east-1")


def _lambda_dir():
    d = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "lambdas"))
    if d not in sys.path:
        sys.path.insert(0, d)
    return d


@claims_bp.post("/claims/generate")
@jwt_required
def generate_claims():
    """Run synthetic_fhir_claims lambda only — generates raw CSV with intentional missing dates."""
    _lambda_dir()
    import synthetic_fhir_claims as _gen
    importlib.reload(_gen)
    gen_result = _gen.lambda_handler({}, None)
    if gen_result.get("statusCode") != 200:
        return jsonify(gen_result), 500
    return jsonify(gen_result)


@claims_bp.post("/claims/clean")
@jwt_required
def clean_claims():
    """Run claims_cleaner lambda — cleans CSV + registers in Glue catalog.
    If no key provided, automatically uses the most recent CSV in S3."""
    data   = request.get_json(force=True) or {}
    key    = data.get("key") or request.args.get("key", "").strip()
    bucket = data.get("bucket", BUCKET)
    if not key:
        s3   = boto3.client("s3", region_name=REGION)
        resp = s3.list_objects_v2(Bucket=bucket, Prefix=CLAIMS_PREFIX)
        objs = sorted(resp.get("Contents", []), key=lambda x: x["LastModified"], reverse=True)
        if not objs:
            return jsonify({"status": "error", "message": "no CSV files found in S3"}), 404
        key = objs[0]["Key"]
    _lambda_dir()
    import claims_cleaner as _mod
    importlib.reload(_mod)
    result = _mod.lambda_handler({"bucket": bucket, "key": key}, None)
    return jsonify(result)


@claims_bp.get("/claims/files")
@jwt_required
def list_claims_files():
    """List CSV files under claims/ prefix."""
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


@claims_bp.get("/claims/parquet-files")
@jwt_required
def list_parquet_files():
    """List Parquet files under claims-parquet/ prefix."""
    s3   = boto3.client("s3", region_name=REGION)
    resp = s3.list_objects_v2(Bucket=BUCKET, Prefix=PARQUET_PREFIX)
    files = []
    for obj in resp.get("Contents", []):
        key = obj["Key"]
        if key.endswith(".parquet"):
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
    reader = csv.DictReader(io.TextIOWrapper(obj["Body"], encoding="utf-8"))
    rows = list(reader)
    return jsonify({"rows": rows, "count": len(rows), "key": key})
