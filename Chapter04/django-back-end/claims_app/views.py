# Databricks notebook source
"""claims_app/views.py — /claims/* endpoints."""
import csv
import importlib
import io
import os
import sys

import boto3
from rest_framework.decorators import api_view
from rest_framework.response import Response
from utils.jwt_utils import jwt_required

BUCKET         = os.getenv("STAGING_BUCKET",  "dgs-glue-staging")
CLAIMS_PREFIX  = os.getenv("CLAIMS_PREFIX",   "claims/")
PARQUET_PREFIX = os.getenv("CLEAN_PREFIX",    "claims-parquet/")
REGION         = os.getenv("AWS_REGION",      "us-east-1")


def _lambda_dir():
    d = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "lambdas"))
    if d not in sys.path:
        sys.path.insert(0, d)
    return d


@api_view(["POST"])
@jwt_required
def generate_claims(request):
    _lambda_dir()
    try:
        import synthetic_fhir_claims as _gen
        importlib.reload(_gen)
        result = _gen.lambda_handler({}, None)
        status = result.get("statusCode", 200)
        return Response(result, status=status if status != 200 else 200)
    except Exception as exc:
        return Response({"status": "error", "message": str(exc)}, status=500)


@api_view(["POST"])
@jwt_required
def clean_claims(request):
    data = request.data or {}
    key  = data.get("key") or request.query_params.get("key", "").strip()
    bucket = data.get("bucket", BUCKET)
    delete_after = data.get("delete_after", False)
    if not key:
        s3   = boto3.client("s3", region_name=REGION)
        resp = s3.list_objects_v2(Bucket=bucket, Prefix=CLAIMS_PREFIX)
        objs = sorted(resp.get("Contents", []), key=lambda x: x["LastModified"], reverse=True)
        if not objs:
            return Response({"status": "error", "message": "no CSV files found in S3"}, status=404)
        key = objs[0]["Key"]
    _lambda_dir()
    try:
        import claims_cleaner as _mod
        importlib.reload(_mod)
        result = _mod.lambda_handler({"bucket": bucket, "key": key}, None)
        if delete_after and result.get("statusCode") == 200:
            boto3.client("s3", region_name=REGION).delete_object(Bucket=bucket, Key=key)
        return Response(result, status=result.get("statusCode", 200))
    except Exception as exc:
        return Response({"status": "error", "message": str(exc)}, status=500)


@api_view(["POST"])
@jwt_required
def process_all_claims(request):
    data = request.data or {}
    _lambda_dir()
    try:
        import synthetic_fhir_claims as _gen
        import claims_cleaner as _clean
        importlib.reload(_gen); importlib.reload(_clean)
        gen_result = _gen.lambda_handler({}, None)
        if gen_result.get("statusCode") != 200:
            return Response(gen_result, status=500)
        key    = gen_result.get("key") or gen_result.get("body", {}).get("key")
        bucket = data.get("bucket", BUCKET)
        delete_after = data.get("delete_after", True)
        result = _clean.lambda_handler({"bucket": bucket, "key": key}, None)
        if delete_after and result.get("statusCode") == 200:
            boto3.client("s3", region_name=REGION).delete_object(Bucket=bucket, Key=key)
        return Response({"generate": gen_result, "clean": result})
    except Exception as exc:
        return Response({"status": "error", "message": str(exc)}, status=500)


@api_view(["GET"])
@jwt_required
def list_claims_files(request):
    bucket = request.query_params.get("bucket", BUCKET)
    prefix = request.query_params.get("prefix", CLAIMS_PREFIX)
    try:
        s3   = boto3.client("s3", region_name=REGION)
        resp = s3.list_objects_v2(Bucket=bucket, Prefix=prefix)
        files = [{"key": o["Key"], "size": o["Size"], "lastModified": o["LastModified"].isoformat()}
                 for o in resp.get("Contents", [])]
        return Response({"files": files, "count": len(files)})
    except Exception as exc:
        return Response({"status": "error", "message": str(exc)}, status=500)


@api_view(["GET"])
@jwt_required
def list_parquet_files(request):
    bucket = request.query_params.get("bucket", BUCKET)
    prefix = request.query_params.get("prefix", PARQUET_PREFIX)
    try:
        s3   = boto3.client("s3", region_name=REGION)
        resp = s3.list_objects_v2(Bucket=bucket, Prefix=prefix)
        files = [{"key": o["Key"], "size": o["Size"], "lastModified": o["LastModified"].isoformat()}
                 for o in resp.get("Contents", [])]
        return Response({"files": files, "count": len(files)})
    except Exception as exc:
        return Response({"status": "error", "message": str(exc)}, status=500)


@api_view(["GET"])
@jwt_required
def get_claims_file(request):
    bucket = request.query_params.get("bucket", BUCKET)
    key    = request.query_params.get("key", "")
    if not key:
        return Response({"status": "error", "message": "key is required"}, status=400)
    try:
        s3  = boto3.client("s3", region_name=REGION)
        obj = s3.get_object(Bucket=bucket, Key=key)
        content = obj["Body"].read().decode("utf-8")
        rows = list(csv.DictReader(io.StringIO(content)))
        return Response({"key": key, "rows": rows, "count": len(rows)})
    except Exception as exc:
        return Response({"status": "error", "message": str(exc)}, status=500)
