# Databricks notebook source
import json, os, time
import boto3
from fastapi import FastAPI, Depends, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel
from typing import Optional
import jwt

app = FastAPI(title="Athena Client Microservice")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


REGION         = os.getenv("AWS_REGION",           "us-east-1")
OUTPUT_BUCKET  = os.getenv("STAGING_BUCKET",        "dgs-glue-staging")
OUTPUT_PREFIX  = os.getenv("ATHENA_OUTPUT_PREFIX",  "athena-results/")
DEFAULT_DB     = os.getenv("GLUE_DATABASE",          "fhir-table-db")
WORKGROUP      = os.getenv("ATHENA_WORKGROUP",       "primary")
JWT_SECRET     = os.getenv("JWT_SECRET", "health-care-dev-secret")
MAX_POLL_SECS  = 45
bearer = HTTPBearer()

def require_jwt(creds: HTTPAuthorizationCredentials = Depends(bearer)):
    try:
        return jwt.decode(creds.credentials, JWT_SECRET, algorithms=["HS256"],
                          options={"require": ["sub", "exp", "iat"]})
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {e}")

def _athena(): return boto3.client("athena", region_name=REGION)
def _glue():   return boto3.client("glue",   region_name=REGION)

def _execute(sql: str, database: str):
    output = f"s3://{OUTPUT_BUCKET}/{OUTPUT_PREFIX}"
    client = _athena()
    resp   = client.start_query_execution(
        QueryString=sql, QueryExecutionContext={"Database": database},
        ResultConfiguration={"OutputLocation": output}, WorkGroup=WORKGROUP,
    )
    qid      = resp["QueryExecutionId"]
    deadline = time.monotonic() + MAX_POLL_SECS
    exec_ctx = {}
    while time.monotonic() < deadline:
        status   = client.get_query_execution(QueryExecutionId=qid)
        exec_ctx = status["QueryExecution"]
        state    = exec_ctx["Status"]["State"]
        if state == "SUCCEEDED": break
        if state in ("FAILED", "CANCELLED"):
            raise RuntimeError(f"Athena {state}: {exec_ctx['Status'].get('StateChangeReason', state)}")
        time.sleep(1.2)
    else:
        raise TimeoutError(f"Query exceeded {MAX_POLL_SECS}s")
    stats = exec_ctx.get("Statistics", {})
    columns, rows, first = [], [], True
    for page in client.get_paginator("get_query_results").paginate(QueryExecutionId=qid):
        page_rows = page.get("ResultSet", {}).get("Rows", [])
        if first:
            if page_rows:
                columns   = [c.get("VarCharValue", "") for c in page_rows[0]["Data"]]
                page_rows = page_rows[1:]
            first = False
        for row in page_rows:
            rows.append({columns[i]: cell.get("VarCharValue", "") for i, cell in enumerate(row["Data"])})
    return {"query_execution_id": qid, "columns": columns, "rows": rows, "count": len(rows),
            "elapsed_ms": stats.get("TotalExecutionTimeInMillis", 0),
            "scanned_bytes": stats.get("DataScannedInBytes", 0), "output_location": output}

class QueryRequest(BaseModel):
    sql: str
    database: Optional[str] = None

class GenerateSQLRequest(BaseModel):
    prompt: str
    database: Optional[str] = None

@app.get("/health")
def health():
    return {"status": "ok", "service": "athena_client"}

@app.get("/athena/databases")
@limiter.limit("60/minute")
def list_databases(request: Request, _user=Depends(require_jwt)):
    try:
        dbs = sorted(db["Name"] for db in _glue().get_databases().get("DatabaseList", []))
        return {"databases": dbs}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@app.get("/athena/tables")
@limiter.limit("60/minute")
def list_tables(request: Request, database: str = Query(DEFAULT_DB), _user=Depends(require_jwt)):
    try:
        tables = sorted(t["Name"] for t in _glue().get_tables(DatabaseName=database).get("TableList", []))
        return {"database": database, "tables": tables}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@app.get("/athena/schema")
@limiter.limit("30/minute")
def get_schema(request: Request, database: str = Query(DEFAULT_DB), _user=Depends(require_jwt)):
    try:
        schema = {}
        for t in _glue().get_tables(DatabaseName=database).get("TableList", []):
            cols = [{"name": c["Name"], "type": c["Type"]}
                    for c in t.get("StorageDescriptor", {}).get("Columns", [])]
            for pk in t.get("PartitionKeys", []):
                cols.append({"name": pk["Name"] + " (partition)", "type": pk.get("Type", "")})
            schema[t["Name"]] = cols
        return {"database": database, "schema": schema}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@app.post("/athena/query")
@limiter.limit("20/minute")
def run_query(request: Request, req: QueryRequest, _user=Depends(require_jwt)):
    sql = (req.sql or "").strip()
    db  = (req.database or DEFAULT_DB).strip()
    if not sql:
        raise HTTPException(status_code=400, detail="sql is required")
    try:
        return {"status": "ok", "database": db, **_execute(sql, db)}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@app.post("/athena/generate-sql")
@limiter.limit("10/minute")
def generate_sql(request: Request, req: GenerateSQLRequest, _user=Depends(require_jwt)):
    prompt   = (req.prompt or "").strip()
    database = (req.database or DEFAULT_DB).strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="prompt is required")
    try:
        schema_lines = []
        for t in _glue().get_tables(DatabaseName=database).get("TableList", []):
            col_str = ", ".join(f"{c['Name']} {c['Type']}" for c in t.get("StorageDescriptor", {}).get("Columns", []))
            schema_lines.append(f"  {t['Name']}({col_str})")
        schema_ctx = "\n".join(schema_lines) or "  (no tables found)"
    except Exception:
        schema_ctx = "  (schema unavailable)"
    sys_msg = (f"You are an expert Amazon Athena SQL generator (Presto SQL dialect).\n"
               f"Database: {database}\nAvailable tables:\n{schema_ctx}\n\n"
               "Rules:\n- Return ONLY the SQL, no explanation, no markdown.\n"
               "- Use Athena/Presto syntax.\n- Always LIMIT unless pure aggregation.\n")
    payload = json.dumps({
        "system":   [{"text": sys_msg}],
        "messages": [{"role": "user", "content": [{"text": prompt}]}],
        "inferenceConfig": {"maxTokens": 1024, "temperature": 0.1},
    })
    try:
        client   = boto3.client("bedrock-runtime", region_name=REGION)
        response = client.invoke_model(modelId="amazon.nova-lite-v1:0", body=payload,
                                       contentType="application/json", accept="application/json")
        result = json.loads(response["body"].read())
        sql    = result["output"]["message"]["content"][0]["text"].strip()
        sql    = "\n".join(l for l in sql.splitlines() if not l.strip().startswith("```")).strip()
        return {"status": "ok", "sql": sql, "model": "amazon.nova-lite-v1:0"}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=4014)
