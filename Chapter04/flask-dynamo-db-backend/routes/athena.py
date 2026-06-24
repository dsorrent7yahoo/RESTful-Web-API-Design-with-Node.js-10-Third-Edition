"""
routes/athena.py
Athena SQL client — queries the Glue Catalog and returns results as JSON.
"""
import json
import os
import time

import boto3
from flask import Blueprint, jsonify, request

from utils.jwt_utils import jwt_required

athena_bp = Blueprint("athena", __name__)

REGION         = os.getenv("AWS_REGION",          "us-east-1")
OUTPUT_BUCKET  = os.getenv("STAGING_BUCKET",      "dgs-glue-staging")
OUTPUT_PREFIX  = os.getenv("ATHENA_OUTPUT_PREFIX", "athena-results/")
DEFAULT_DB     = os.getenv("GLUE_DATABASE",       "fhir-table-db")
MAX_POLL_SECS  = 45
WORKGROUP      = os.getenv("ATHENA_WORKGROUP",    "primary")


def _athena():
    return boto3.client("athena", region_name=REGION)


def _glue():
    return boto3.client("glue", region_name=REGION)


def _execute(sql: str, database: str) -> dict:
    """Start an Athena query, poll to completion, return columns + rows."""
    output = f"s3://{OUTPUT_BUCKET}/{OUTPUT_PREFIX}"
    client = _athena()

    resp = client.start_query_execution(
        QueryString=sql,
        QueryExecutionContext={"Database": database},
        ResultConfiguration={"OutputLocation": output},
        WorkGroup=WORKGROUP,
    )
    qid = resp["QueryExecutionId"]

    deadline = time.monotonic() + MAX_POLL_SECS
    while time.monotonic() < deadline:
        status   = client.get_query_execution(QueryExecutionId=qid)
        exec_ctx = status["QueryExecution"]
        state    = exec_ctx["Status"]["State"]
        if state == "SUCCEEDED":
            break
        if state in ("FAILED", "CANCELLED"):
            reason = exec_ctx["Status"].get("StateChangeReason", state)
            raise RuntimeError(f"Athena query {state}: {reason}")
        time.sleep(1.2)
    else:
        raise TimeoutError(f"Query exceeded {MAX_POLL_SECS}s timeout")

    stats = exec_ctx.get("Statistics", {})
    elapsed_ms = stats.get("TotalExecutionTimeInMillis", 0)
    scanned_bytes = stats.get("DataScannedInBytes", 0)

    # Paginate all rows
    columns, rows = [], []
    paginator = client.get_paginator("get_query_results")
    first_page = True
    for page in paginator.paginate(QueryExecutionId=qid):
        page_rows = page.get("ResultSet", {}).get("Rows", [])
        if first_page:
            columns = [col.get("VarCharValue", "") for col in page_rows[0]["Data"]]
            page_rows = page_rows[1:]
            first_page = False
        for row in page_rows:
            rows.append(
                {columns[i]: cell.get("VarCharValue", "")
                 for i, cell in enumerate(row["Data"])}
            )

    return {
        "query_execution_id": qid,
        "columns":            columns,
        "rows":               rows,
        "count":              len(rows),
        "elapsed_ms":         elapsed_ms,
        "scanned_bytes":      scanned_bytes,
        "output_location":    output,
    }


# ─── endpoints ────────────────────────────────────────────────────────────────

@athena_bp.post("/athena/query")
@jwt_required
def run_query():
    body = request.get_json(force=True) or {}
    sql  = (body.get("sql") or "").strip()
    db   = (body.get("database") or DEFAULT_DB).strip()
    if not sql:
        return jsonify({"error": "sql is required"}), 400
    try:
        result = _execute(sql, db)
        return jsonify({"status": "ok", "database": db, **result})
    except Exception as exc:
        return jsonify({"status": "error", "error": str(exc)}), 400


@athena_bp.get("/athena/databases")
@jwt_required
def list_databases():
    try:
        resp = _glue().get_databases()
        dbs  = sorted(db["Name"] for db in resp.get("DatabaseList", []))
        return jsonify({"databases": dbs})
    except Exception as exc:
        return jsonify({"error": str(exc)}), 400


@athena_bp.get("/athena/tables")
@jwt_required
def list_tables():
    db = (request.args.get("database") or DEFAULT_DB).strip()
    try:
        resp   = _glue().get_tables(DatabaseName=db)
        tables = sorted(t["Name"] for t in resp.get("TableList", []))
        return jsonify({"database": db, "tables": tables})
    except Exception as exc:
        return jsonify({"error": str(exc)}), 400


@athena_bp.get("/athena/schema")
@jwt_required
def get_schema():
    """Return all tables with column names+types for the schema browser."""
    db = (request.args.get("database") or DEFAULT_DB).strip()
    try:
        resp   = _glue().get_tables(DatabaseName=db)
        schema = {}
        for t in resp.get("TableList", []):
            cols = [
                {"name": c["Name"], "type": c["Type"]}
                for c in t.get("StorageDescriptor", {}).get("Columns", [])
            ]
            # include Glue partition keys too
            for pk in t.get("PartitionKeys", []):
                cols.append({"name": pk["Name"] + " (partition)", "type": pk.get("Type", "")})
            schema[t["Name"]] = cols
        return jsonify({"database": db, "schema": schema})
    except Exception as exc:
        return jsonify({"error": str(exc)}), 400


@athena_bp.post("/athena/generate-sql")
@jwt_required
def generate_sql():
    body     = request.get_json(force=True) or {}
    prompt   = (body.get("prompt") or "").strip()
    database = (body.get("database") or DEFAULT_DB).strip()
    if not prompt:
        return jsonify({"error": "prompt is required"}), 400

    try:
        tables_resp  = _glue().get_tables(DatabaseName=database)
        schema_lines = []
        for t in tables_resp.get("TableList", []):
            col_str = ", ".join(
                "{} {}".format(c["Name"], c["Type"])
                for c in t.get("StorageDescriptor", {}).get("Columns", [])
            )
            schema_lines.append("  {}({})".format(t["Name"], col_str))
        schema_ctx = "\n".join(schema_lines) or "  (no tables found)"
    except Exception:
        schema_ctx = "  (schema unavailable)"

    sys_msg = (
        "You are an expert Amazon Athena SQL generator (Presto SQL dialect).\n"
        "Database: {}\n".format(database) +
        "Available tables:\n{}\n\n".format(schema_ctx) +
        "Rules:\n"
        "- Return ONLY the SQL query, no explanation, no markdown, no code fences.\n"
        "- Use Athena/Presto SQL syntax.\n"
        "- Always LIMIT unless the query is a pure aggregation.\n"
        "- Column and table names are lowercase.\n"
    )

    # Amazon Nova Lite payload format
    payload = json.dumps({
        "system": [{"text": sys_msg}],
        "messages": [{"role": "user", "content": [{"text": prompt}]}],
        "inferenceConfig": {"maxTokens": 1024, "temperature": 0.1},
    })

    try:
        client   = boto3.client("bedrock-runtime", region_name=REGION)
        response = client.invoke_model(
            modelId     = "amazon.nova-lite-v1:0",
            body        = payload,
            contentType = "application/json",
            accept      = "application/json",
        )
        result = json.loads(response["body"].read())
        sql    = result["output"]["message"]["content"][0]["text"].strip()
        # strip any accidental markdown fences
        clean = []
        for line in sql.splitlines():
            if line.strip().startswith("```"):
                continue
            clean.append(line)
        sql = "\n".join(clean).strip()
        return jsonify({"status": "ok", "sql": sql, "model": "amazon.nova-lite-v1:0"})
    except Exception as exc:
        return jsonify({"status": "error", "error": str(exc)}), 400
