# Databricks notebook source
""" athena_app/views.py — Athena SQL client endpoints.  Database views. """
import json, os, time
import boto3
from rest_framework.decorators import api_view
from rest_framework.response import Response
from utils.jwt_utils import jwt_required

REGION        = os.getenv("AWS_REGION",           "us-east-1")
OUTPUT_BUCKET = os.getenv("STAGING_BUCKET",       "dgs-glue-staging")
OUTPUT_PREFIX = os.getenv("ATHENA_OUTPUT_PREFIX",  "athena-results/")
DEFAULT_DB    = os.getenv("GLUE_DATABASE",         "fhir-table-db")
WORKGROUP     = os.getenv("ATHENA_WORKGROUP",      "primary")
MAX_POLL_SECS = 45

def _athena(): return boto3.client("athena", region_name=REGION)
def _glue():   return boto3.client("glue",   region_name=REGION)


_COL_ALIASES = [
    ("medication_name",        "description"),
    ("drug_name",              "description"),
    ("med_name",               "description"),
    ("medications.patient_id", "medications.patient"),
    ("claims.patient_id",      "claims.patient"),
]

def _normalise_sql(sql):
    for wrong, right in _COL_ALIASES:
        sql = re.sub(r"(?i)\b" + re.escape(wrong) + r"\b", right, sql)
    return sql

def _execute(sql, database):
    output = f"s3://{OUTPUT_BUCKET}/{OUTPUT_PREFIX}"
    client = _athena()
    resp   = client.start_query_execution(
        QueryString=sql, QueryExecutionContext={"Database": database},
        ResultConfiguration={"OutputLocation": output}, WorkGroup=WORKGROUP)
    qid      = resp["QueryExecutionId"]
    deadline = time.monotonic() + MAX_POLL_SECS
    exec_ctx = {}
    while time.monotonic() < deadline:
        status   = client.get_query_execution(QueryExecutionId=qid)
        exec_ctx = status["QueryExecution"]
        state    = exec_ctx["Status"]["State"]
        if state == "SUCCEEDED": break
        if state in ("FAILED","CANCELLED"):
            raise RuntimeError(f"Athena {state}: {exec_ctx['Status'].get('StateChangeReason',state)}")
        time.sleep(1.2)
    else: raise TimeoutError(f"Query exceeded {MAX_POLL_SECS}s")
    stats    = exec_ctx.get("Statistics", {})
    columns, rows = [], []
    first = True
    for page in client.get_paginator("get_query_results").paginate(QueryExecutionId=qid):
        page_rows = page.get("ResultSet", {}).get("Rows", [])
        if first:
            columns = [c.get("VarCharValue","") for c in page_rows[0]["Data"]]
            page_rows = page_rows[1:]; first = False
        for row in page_rows:
            rows.append({columns[i]: cell.get("VarCharValue","") for i, cell in enumerate(row["Data"])})
    return {"query_execution_id": qid, "columns": columns, "rows": rows, "count": len(rows),
            "elapsed_ms": stats.get("TotalExecutionTimeInMillis",0),
            "scanned_bytes": stats.get("DataScannedInBytes",0), "output_location": output}

@api_view(["POST"])
@jwt_required
def run_query(request):
    body = request.data or {}
    sql  = (body.get("sql") or "").strip()
    db   = (body.get("database") or DEFAULT_DB).strip()
    if not sql: return Response({"error": "sql is required"}, status=400)
    sql = _normalise_sql(sql)
    try:    return Response({"status": "ok", "database": db, **_execute(sql, db)})
    except Exception as exc: return Response({"status": "error", "error": str(exc)}, status=400)

@api_view(["GET"])
@jwt_required
def list_databases(request):
    try:
        dbs = sorted(db["Name"] for db in _glue().get_databases().get("DatabaseList",[]))
        return Response({"databases": dbs})
    except Exception as exc: return Response({"error": str(exc)}, status=400)

@api_view(["GET"])
@jwt_required
def list_tables(request):
    db = (request.query_params.get("database") or DEFAULT_DB).strip()
    try:
        tables = sorted(t["Name"] for t in _glue().get_tables(DatabaseName=db).get("TableList",[]))
        return Response({"database": db, "tables": tables})
    except Exception as exc: return Response({"error": str(exc)}, status=400)

@api_view(["GET"])
@jwt_required
def get_schema(request):
    db = (request.query_params.get("database") or DEFAULT_DB).strip()
    try:
        schema = {}
        for t in _glue().get_tables(DatabaseName=db).get("TableList",[]):
            cols = [{"name": c["Name"],"type": c["Type"]} for c in t.get("StorageDescriptor",{}).get("Columns",[])]
            for pk in t.get("PartitionKeys",[]):
                cols.append({"name": pk["Name"]+" (partition)","type": pk.get("Type","")})
            schema[t["Name"]] = cols
        return Response({"database": db, "schema": schema})
    except Exception as exc: return Response({"error": str(exc)}, status=400)

@api_view(["POST"])
@jwt_required
def generate_sql(request):
    body     = request.data or {}
    prompt   = (body.get("prompt") or "").strip()
    database = (body.get("database") or DEFAULT_DB).strip()
    if not prompt: return Response({"error": "prompt is required"}, status=400)
    try:
        schema_lines = []
        for t in _glue().get_tables(DatabaseName=database).get("TableList",[]):
            col_str = ", ".join(f"{c['Name']} {c['Type']}" for c in t.get("StorageDescriptor",{}).get("Columns",[]))
            schema_lines.append(f"  {t['Name']}({col_str})")
        schema_ctx = "\n".join(schema_lines) or "  (no tables found)"
    except Exception: schema_ctx = "  (schema unavailable)"
    sys_msg = (f"You are an expert Amazon Athena SQL generator (Presto SQL dialect).\n"
               f"Database: {database}\nAvailable tables:\n{schema_ctx}\n\n"
               "Rules:\n- Return ONLY the SQL, no explanation, no markdown.\n"
               "- Use Athena/Presto syntax.\n- Always LIMIT unless pure aggregation.\n")
    payload = json.dumps({"system":[{"text":sys_msg}],
                          "messages":[{"role":"user","content":[{"text":prompt}]}],
                          "inferenceConfig":{"maxTokens":1024,"temperature":0.1}})
    try:
        client   = boto3.client("bedrock-runtime", region_name=REGION)
        response = client.invoke_model(modelId="amazon.nova-lite-v1:0", body=payload,
                                       contentType="application/json", accept="application/json")
        result = json.loads(response["body"].read())
        sql    = result["output"]["message"]["content"][0]["text"].strip()
        sql    = "\n".join(l for l in sql.splitlines() if not l.strip().startswith("```")).strip()
        sql    = _normalise_sql(sql)
        return Response({"status":"ok","sql":sql,"model":"amazon.nova-lite-v1:0"})
    except Exception as exc: return Response({"status":"error","error":str(exc)}, status=400)
