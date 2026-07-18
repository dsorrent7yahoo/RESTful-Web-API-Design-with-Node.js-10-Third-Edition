import csv
import io
import pathlib
import re

from flask import Blueprint, jsonify, request

from utils.jwt_utils import jwt_required
from tools.aws_export import DynamoToS3Exporter

glue_upload_bp = Blueprint("glue_upload", __name__)
_exporter = DynamoToS3Exporter()


@glue_upload_bp.post("/upload/glue-csv")
@jwt_required
def upload_csvs_to_glue():
    """Upload CSV files to S3 and register them in the Glue Data Catalog."""
    database    = str(request.form.get("database", "fhir-table-db")).strip()
    bucket      = str(request.form.get("bucket", "dgs-glue-staging")).strip()
    prefix_root = str(request.form.get("prefix", "datalake/")).strip().rstrip("/") + "/"
    create_db   = request.form.get("createDatabase", "true").lower() not in ("false", "0")

    if not bucket:
        return jsonify({"status": "error", "message": "bucket is required"}), 400

    uploaded_files = request.files.getlist("files[]")
    if not uploaded_files:
        return jsonify({"status": "error", "message": "No files uploaded"}), 400

    results = []
    for f in uploaded_files:
        filename   = f.filename or "upload.csv"
        stem       = pathlib.Path(filename).stem
        table_name = re.sub(r"[^a-z0-9_]", "_", stem.lower())

        raw = f.read()
        try:
            text = raw.decode("utf-8-sig")
        except UnicodeDecodeError:
            text = raw.decode("latin-1")

        columns = []
        try:
            reader = csv.reader(io.StringIO(text))
            header = next(reader, [])
            for col in header:
                safe = col.strip().lower().replace(" ", "_").replace("-", "_")
                safe = re.sub(r"[^a-z0-9_]", "_", safe) or "col"
                columns.append({"name": safe, "type": "string"})
        except Exception as exc:
            results.append({"file": filename, "table": table_name,
                            "status": "error", "message": f"CSV parse error: {exc}"})
            continue

        s3_key = f"{prefix_root}{table_name}/{filename}"
        s3_uri = f"s3://{bucket}/{prefix_root}{table_name}/"
        try:
            _exporter._s3.put_object(
                Bucket=bucket, Key=s3_key, Body=raw, ContentType="text/csv",
            )
        except Exception as exc:
            results.append({"file": filename, "table": table_name,
                            "status": "error", "message": f"S3 upload failed: {exc}"})
            continue

        try:
            glue_result = _exporter.register_glue_table(
                database=database, table_name=table_name, s3_uri=s3_uri,
                fmt="csv", columns=columns, create_database=create_db,
            )
            results.append({
                "file": filename, "table": table_name, "s3Uri": s3_uri,
                "s3Key": s3_key, "columns": len(columns),
                "action": glue_result.get("action", "registered"),
                "status": "ok",
            })
        except Exception as exc:
            results.append({"file": filename, "table": table_name,
                            "s3Uri": s3_uri, "status": "error",
                            "message": f"Glue registration failed: {exc}"})

    ok_count  = sum(1 for r in results if r["status"] == "ok")
    err_count = len(results) - ok_count
    return jsonify({
        "database": database, "bucket": bucket, "results": results,
        "summary": {"ok": ok_count, "errors": err_count},
    })
