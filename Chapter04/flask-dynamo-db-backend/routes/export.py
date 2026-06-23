"""
routes/export.py
Blueprint for DynamoDB → S3 export and Glue Data Catalog registration.
All routes require JWT.
"""
import json
from flask import Blueprint, Response, g, jsonify, request, stream_with_context

from model import medication as medication_model
from tools.aws_export import DynamoToS3Exporter
from utils.jwt_utils import jwt_required

export_bp = Blueprint("export", __name__)

# One shared exporter instance (lazy-initialises boto3 clients)
_exporter = DynamoToS3Exporter()


# ---------------------------------------------------------------------------
# S3 bucket helpers
# ---------------------------------------------------------------------------

@export_bp.get("/export/s3/buckets")
@jwt_required
def list_s3_buckets():
    """List all S3 buckets visible to the configured AWS credentials."""
    try:
        buckets = _exporter.list_buckets()
        return jsonify({"buckets": buckets, "count": len(buckets)})
    except Exception as exc:
        return jsonify({"status": "error", "message": str(exc)}), 500


@export_bp.get("/export/s3/<bucket>/objects")
@jwt_required
def list_bucket_objects(bucket):
    """
    List objects inside a bucket.

    Query params:
        prefix   (optional) filter key prefix
    """
    prefix = request.args.get("prefix", "")
    try:
        objects = _exporter.list_objects(bucket=bucket, prefix=prefix)
        return jsonify({"bucket": bucket, "objects": objects, "count": len(objects)})
    except Exception as exc:
        return jsonify({"status": "error", "message": str(exc)}), 500


@export_bp.delete("/export/s3/<bucket>")
@jwt_required
def delete_bucket(bucket):
    """
    Delete an S3 bucket.

    Query params:
        force=true   empty the bucket before deleting (default false)
    """
    force = request.args.get("force", "false").lower() in ("true", "1", "yes")
    try:
        _exporter.delete_bucket(bucket=bucket, force=force)
        return jsonify({"status": "ok", "message": f"Bucket '{bucket}' deleted."})
    except Exception as exc:
        return jsonify({"status": "error", "message": str(exc)}), 500


@export_bp.get("/export/s3/<bucket>/download")
@jwt_required
def download_object(bucket):
    """
    Generate a presigned download URL for an S3 object.

    Query params:
        key      (required) object key
        expires  seconds until URL expires (default 3600)
    """
    key = request.args.get("key", "").strip()
    if not key:
        return jsonify({"status": "error", "message": "key query param is required"}), 400
    try:
        expires = int(request.args.get("expires", 3600))
    except ValueError:
        expires = 3600
    try:
        url = _exporter.generate_download_url(bucket=bucket, key=key, expires=expires)
        return jsonify({"status": "ok", "url": url, "bucket": bucket, "key": key, "expiresIn": expires})
    except Exception as exc:
        return jsonify({"status": "error", "message": str(exc)}), 500


# ---------------------------------------------------------------------------
# DynamoDB → S3 export
# ---------------------------------------------------------------------------

@export_bp.post("/export/s3")
@jwt_required
def export_to_s3():
    """
    Export a DynamoDB table to S3 as CSV or NDJSON.

    Body (JSON):
        tableName        (required) DynamoDB table to export
        bucket           (required) S3 bucket name
        prefix           S3 key prefix (default: exports/<tableName>/)
        format           'csv' or 'ndjson'  (default: csv)
        createBucket     create bucket if it doesn't exist (default: false)

    Returns:
        { s3Uri, s3Bucket, s3Key, rows, sizeBytes, format, tableName }
    """
    body = request.get_json(silent=True) or {}

    table_name = str(body.get("tableName", "")).strip()
    bucket = str(body.get("bucket", "")).strip()

    if not table_name:
        return jsonify({"status": "error", "message": "tableName is required"}), 400
    if not bucket:
        return jsonify({"status": "error", "message": "bucket is required"}), 400

    fmt = str(body.get("format", "csv")).strip().lower()
    prefix = body.get("prefix") or None
    create_bucket = body.get("createBucket") in (True, "true", "1", 1)

    try:
        result = _exporter.export_table_to_s3(
            table_name=table_name,
            bucket=bucket,
            prefix=prefix,
            fmt=fmt,
            create_bucket=create_bucket,
        )
        return jsonify({"status": "ok", **result})
    except ValueError as exc:
        return jsonify({"status": "error", "message": str(exc)}), 400
    except Exception as exc:
        return jsonify({"status": "error", "message": str(exc)}), 500


# ---------------------------------------------------------------------------
# Glue Data Catalog registration
# ---------------------------------------------------------------------------

@export_bp.get("/export/glue/databases")
@jwt_required
def list_glue_databases():
    """List Glue Data Catalog databases."""
    try:
        databases = _exporter.list_glue_databases()
        return jsonify({"databases": databases, "count": len(databases)})
    except Exception as exc:
        return jsonify({"status": "error", "message": str(exc)}), 500


@export_bp.get("/export/glue/databases/<string:database>/tables")
@jwt_required
def list_glue_tables(database):
    """List Glue tables in a database."""
    try:
        tables = _exporter.list_glue_tables(database)
        return jsonify({"database": database, "tables": tables, "count": len(tables)})
    except Exception as exc:
        return jsonify({"status": "error", "message": str(exc)}), 500


@export_bp.post("/export/glue")
@jwt_required
def register_glue_table():
    """
    Register an S3 path in the AWS Glue Data Catalog for Databricks access.

    Body (JSON):
        database         (required) Glue database name
        tableName        (required) Glue table name
        s3Uri            (required) 's3://bucket/prefix/' pointing to the exported data
        format           'csv' or 'ndjson'  (default: csv)
        createDatabase   create Glue database if missing (default: true)
        columns          optional list of {name, type} for schema
                         e.g. [{"name":"id","type":"string"},{"name":"baseCost","type":"double"}]

    Returns:
        { database, tableName, s3Uri, format, action }
    """
    body = request.get_json(silent=True) or {}

    database = str(body.get("database", "")).strip()
    table_name = str(body.get("tableName", "")).strip()
    s3_uri = str(body.get("s3Uri", "")).strip()

    if not database:
        return jsonify({"status": "error", "message": "database is required"}), 400
    if not table_name:
        return jsonify({"status": "error", "message": "tableName is required"}), 400
    if not s3_uri or not s3_uri.startswith("s3://"):
        return jsonify({"status": "error", "message": "s3Uri must start with s3://"}), 400

    fmt = str(body.get("format", "csv")).strip().lower()
    create_database = body.get("createDatabase", True) not in (False, "false", "0", 0)
    columns = body.get("columns") or []

    try:
        result = _exporter.register_glue_table(
            database=database,
            table_name=table_name,
            s3_uri=s3_uri,
            fmt=fmt,
            columns=columns,
            create_database=create_database,
        )
        return jsonify({"status": "ok", **result})
    except ValueError as exc:
        return jsonify({"status": "error", "message": str(exc)}), 400
    except Exception as exc:
        return jsonify({"status": "error", "message": str(exc)}), 500


# ---------------------------------------------------------------------------
# Full Data Lake pipeline  —  all DynamoDB tables → S3 → Glue
# ---------------------------------------------------------------------------

@export_bp.post("/export/pipeline/all")
@jwt_required
def export_all_to_data_lake():
    """
    Export EVERY DynamoDB table to S3 and register each in the Glue Data Catalog.

    Streams newline-delimited JSON progress events so the caller can show
    a live status table.  Each line is valid JSON:

        {"event": "start",    "totalTables": N}
        {"event": "progress", "table": "...", "step": "export|glue", "status": "ok|error",
         "s3Uri": "...", "rows": N, "sizeBytes": N, "message": "..."}
        {"event": "done",     "exported": N, "registered": N, "errors": N,
         "durationSeconds": N}

    Body (JSON):
        bucket           (required) destination S3 bucket
        glueDatabase     Glue database name  (default: "healthcare_data_lake")
        prefix           S3 key prefix root  (default: "datalake/")
        format           "csv" or "ndjson"   (default: "csv")
        createBucket     create bucket if missing (default: false)
        createDatabase   create Glue DB if missing (default: true)
        tables           optional list of table names to include (default: all)
    """
    import time

    body = request.get_json(silent=True) or {}

    bucket = str(body.get("bucket", "")).strip()
    if not bucket:
        return jsonify({"status": "error", "message": "bucket is required"}), 400

    glue_database   = str(body.get("glueDatabase", "healthcare_data_lake")).strip()
    prefix_root     = str(body.get("prefix", "datalake/")).strip().rstrip("/") + "/"
    fmt             = str(body.get("format", "csv")).strip().lower()
    create_bucket   = body.get("createBucket") in (True, "true", "1", 1)
    create_database = body.get("createDatabase", True) not in (False, "false", "0", 0)
    only_tables     = body.get("tables")  # optional list

    def generate():
        start_time = time.time()
        exported = 0
        registered = 0
        errors = 0

        try:
            all_tables = medication_model.list_tables()
        except Exception as exc:
            yield json.dumps({"event": "error", "message": f"Could not list DynamoDB tables: {exc}"}) + "\n"
            return

        tables_to_run = (
            [t for t in all_tables if t in only_tables]
            if only_tables
            else all_tables
        )

        yield json.dumps({"event": "start", "totalTables": len(tables_to_run), "tables": tables_to_run}) + "\n"

        for table_name in tables_to_run:
            table_prefix = f"{prefix_root}{table_name}/"
            s3_uri = None
            # folder URI for Glue — points to the table prefix, NOT the file
            folder_uri = f"s3://{bucket}/{table_prefix}"

            # ── Step 1: export to S3 ──────────────────────────────────────
            try:
                result = _exporter.export_table_to_s3(
                    table_name=table_name,
                    bucket=bucket,
                    prefix=table_prefix,
                    fmt=fmt,
                    create_bucket=create_bucket,
                )
                s3_uri = result.get("s3Uri")
                exported += 1
                yield json.dumps({
                    "event":     "progress",
                    "table":     table_name,
                    "step":      "export",
                    "status":    "ok",
                    "s3Uri":     s3_uri,
                    "rows":      result.get("rows", 0),
                    "sizeBytes": result.get("sizeBytes", 0),
                }) + "\n"
            except Exception as exc:
                errors += 1
                yield json.dumps({
                    "event":   "progress",
                    "table":   table_name,
                    "step":    "export",
                    "status":  "error",
                    "message": str(exc),
                }) + "\n"
                continue  # skip Glue registration if export failed

            # ── Step 2: register in Glue (use folder URI, not file URI) ─────
            try:
                glue_result = _exporter.register_glue_table(
                    database=glue_database,
                    table_name=table_name,
                    s3_uri=folder_uri,
                    fmt=fmt,
                    columns=[],
                    create_database=create_database,
                )
                registered += 1
                yield json.dumps({
                    "event":    "progress",
                    "table":    table_name,
                    "step":     "glue",
                    "status":   "ok",
                    "database": glue_database,
                    "action":   glue_result.get("action", "registered"),
                }) + "\n"
            except Exception as exc:
                errors += 1
                yield json.dumps({
                    "event":   "progress",
                    "table":   table_name,
                    "step":    "glue",
                    "status":  "error",
                    "message": str(exc),
                }) + "\n"

        elapsed = round(time.time() - start_time, 1)
        yield json.dumps({
            "event":           "done",
            "exported":        exported,
            "registered":      registered,
            "errors":          errors,
            "durationSeconds": elapsed,
            "bucket":          bucket,
            "glueDatabase":    glue_database,
        }) + "\n"

    return Response(
        stream_with_context(generate()),
        mimetype="application/x-ndjson",
        headers={"X-Accel-Buffering": "no"},
    )


# ---------------------------------------------------------------------------
# CSV → Data Lake pipeline  —  read local CSVs, upload to S3, register in Glue
# ---------------------------------------------------------------------------

@export_bp.post("/export/pipeline/from-csv")
@jwt_required
def export_csv_to_data_lake():
    """
    Upload the local coherent CSV files directly to S3 and register each
    in the Glue Data Catalog — bypasses DynamoDB entirely.

    Streams newline-delimited JSON progress events (same format as /pipeline/all).

    Body (JSON):
        bucket           (required) destination S3 bucket
        glueDatabase     Glue database name  (default: "healthcare_data_lake")
        prefix           S3 key prefix root  (default: "datalake/")
        createBucket     create bucket if missing (default: false)
        createDatabase   create Glue DB if missing (default: true)
        csvDir           path to CSV folder inside container
                         (default: "/coherent-11-07-2022/csv")
        tables           optional list of table stems to include (default: all)
    """
    import time
    import os
    import glob

    body = request.get_json(silent=True) or {}

    bucket = str(body.get("bucket", "")).strip()
    if not bucket:
        return jsonify({"status": "error", "message": "bucket is required"}), 400

    glue_database   = str(body.get("glueDatabase", "healthcare_data_lake")).strip()
    prefix_root     = str(body.get("prefix", "datalake/")).strip().rstrip("/") + "/"
    create_bucket   = body.get("createBucket") in (True, "true", "1", 1)
    create_database = body.get("createDatabase", True) not in (False, "false", "0", 0)
    csv_dir         = str(body.get("csvDir", "/coherent-11-07-2022/csv")).strip()
    only_tables     = body.get("tables")  # optional list of stems

    def generate():
        start_time = time.time()
        uploaded = 0
        registered = 0
        errors = 0

        # Discover CSV files
        csv_files = sorted(glob.glob(os.path.join(csv_dir, "*.csv")))
        if not csv_files:
            yield json.dumps({"event": "error", "message": f"No CSV files found in {csv_dir}"}) + "\n"
            return

        # Filter by requested tables if provided
        if only_tables:
            only_set = {t.lower() for t in only_tables}
            csv_files = [f for f in csv_files if os.path.splitext(os.path.basename(f))[0].lower() in only_set]

        table_names = [os.path.splitext(os.path.basename(f))[0] for f in csv_files]
        yield json.dumps({"event": "start", "totalTables": len(csv_files), "tables": table_names}) + "\n"

        # Ensure bucket exists if requested
        if create_bucket:
            try:
                _exporter.create_bucket_if_missing(bucket)
            except Exception as exc:
                yield json.dumps({"event": "error", "message": f"Could not create bucket: {exc}"}) + "\n"
                return

        for csv_path in csv_files:
            filename   = os.path.basename(csv_path)
            stem       = os.path.splitext(filename)[0]          # e.g. "allergies"
            s3_key     = f"{prefix_root}{stem}/{filename}"      # datalake/allergies/allergies.csv
            folder_uri = f"s3://{bucket}/{prefix_root}{stem}/"  # datalake/allergies/

            # Read CSV header to build Glue column schema
            import csv as csv_mod
            columns = []
            try:
                with open(csv_path, newline='', encoding='utf-8-sig') as fh:
                    reader = csv_mod.reader(fh)
                    header = next(reader, [])
                    # Sanitize column names: lowercase, spaces→underscores, strip non-alphanum
                    for col in header:
                        safe = col.strip().lower().replace(' ', '_').replace('-', '_')
                        safe = ''.join(c if (c.isalnum() or c == '_') else '_' for c in safe)
                        safe = safe.strip('_') or 'col'
                        columns.append({'name': safe, 'type': 'string'})
            except Exception:
                columns = []  # fall back to schemaless if header read fails

            # ── Step 1: upload CSV to S3 ──────────────────────────────────
            try:
                result = _exporter.upload_local_csv_to_s3(
                    local_path=csv_path,
                    bucket=bucket,
                    s3_key=s3_key,
                )
                uploaded += 1
                yield json.dumps({
                    "event":     "progress",
                    "table":     stem,
                    "step":      "upload",
                    "status":    "ok",
                    "s3Uri":     result["s3Uri"],
                    "sizeBytes": result["sizeBytes"],
                    "columns":   len(columns),
                }) + "\n"
            except Exception as exc:
                errors += 1
                yield json.dumps({
                    "event":   "progress",
                    "table":   stem,
                    "step":    "upload",
                    "status":  "error",
                    "message": str(exc),
                }) + "\n"
                continue  # skip Glue registration if upload failed

            # ── Step 2: register in Glue with full column schema ──────────
            try:
                glue_result = _exporter.register_glue_table(
                    database=glue_database,
                    table_name=stem,
                    s3_uri=folder_uri,
                    fmt="csv",
                    columns=columns,
                    create_database=create_database,
                )
                registered += 1
                yield json.dumps({
                    "event":    "progress",
                    "table":    stem,
                    "step":     "glue",
                    "status":   "ok",
                    "database": glue_database,
                    "s3Uri":    folder_uri,
                    "action":   glue_result.get("action", "registered"),
                }) + "\n"
            except Exception as exc:
                errors += 1
                yield json.dumps({
                    "event":   "progress",
                    "table":   stem,
                    "step":    "glue",
                    "status":  "error",
                    "message": str(exc),
                }) + "\n"

        elapsed = round(time.time() - start_time, 1)
        yield json.dumps({
            "event":           "done",
            "uploaded":        uploaded,
            "registered":      registered,
            "errors":          errors,
            "durationSeconds": elapsed,
            "bucket":          bucket,
            "glueDatabase":    glue_database,
        }) + "\n"

    return Response(
        stream_with_context(generate()),
        mimetype="application/x-ndjson",
        headers={"X-Accel-Buffering": "no"},
    )
