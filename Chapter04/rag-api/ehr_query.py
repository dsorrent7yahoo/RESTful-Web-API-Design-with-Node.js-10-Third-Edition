# Databricks notebook source
"""
ehr_query.py — Natural Language EHR Query API.

ENDPOINTS
---------
POST /ehr/query              Translate natural language → SQL (Athena-compatible)
POST /ehr/query/execute      Execute the SQL via Amazon Athena + Glue Data Catalog
POST /ehr/query/explain      Explain what a natural-language question would query
GET  /ehr/tables             List the queryable table names

PORT: 4007
SWAGGER: http://localhost:4007/docs
RAG API: http://localhost:4005 (must be running)
"""

import os, re, time, httpx, boto3
from dotenv import load_dotenv
load_dotenv()
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

RAG_URL = os.getenv("RAG_URL", "http://localhost:4005")
JWT     = os.getenv("RAG_JWT", "")
REGION  = os.getenv("AWS_REGION", "us-east-1")

# ── Actual DynamoDB/Athena table schemas ─────────────────────────────────────
# Injected into every NL→SQL prompt so the LLM uses real column names.
_TABLE_SCHEMA = """
Table: medications
  Columns: id, patient (FK→patients.id), description (drug/medication name),
           start (prescription start date ISO), stop (end date),
           totalCost, baseCost, payerCoverage, dispenses,
           code, reasonCode, reasonDescription, encounter, payer
Table: patients
  Columns: id, first (first name), last (last name), birthdate, deathdate,
           gender, race, ethnicity, address, city, state, zip, county,
           lat, lon, healthcare_expenses, healthcare_coverage
Table: encounters
  Columns: id, patient (FK→patients.id), start, stop, code, description,
           reasonCode, reasonDescription, payer, totalCost, baseCost, payerCoverage
""".strip()

app = FastAPI(
    title="EHR Natural Language Query API",
    description=(
        "## Query Electronic Health Records in Plain English\n\n"
        "Translates natural-language questions into Athena SQL SELECT statements.\n\n"
        "**Powered by:** RAG API (port 4005) · Athena + Glue Data Catalog\n\n"
        "**Research basis:** CBR-to-SQL arXiv:2603.05569"
    ),
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(CORSMiddleware, allow_origins=["*"],
                   allow_methods=["*"], allow_headers=["*"])

# ── Pydantic models ──────────────────────────────────────────────────────────

class NLQueryRequest(BaseModel):
    question: str = Field(..., min_length=5,
        description="Plain-English question about patient medication records",
        examples=["Find all patients prescribed Warfarin Sodium after 2015",
                  "Which patients are on more than 3 medications?"])
    top_k: int = Field(3, ge=1, le=10)

class QueryResponse(BaseModel):
    question: str
    partiql: str = Field(..., description="Generated Athena SQL SELECT statement")
    explanation: str
    tables_referenced: list[str]
    latency_ms: int
    tokens_total: int

class ExecuteRequest(BaseModel):
    partiql: str = Field(..., description="SQL SELECT statement to execute via Athena")
    limit: int = Field(20, ge=1, le=100)

class ExecuteResponse(BaseModel):
    partiql: str
    rows: list[dict]
    count: int
    truncated: bool
    latency_ms: int

# ── Helpers ──────────────────────────────────────────────────────────────────

def _rag_sql(question: str, top_k: int) -> dict:
    headers = {"Content-Type": "application/json"}
    if JWT:
        headers["Authorization"] = f"Bearer {JWT}"
    try:
        resp = httpx.post(
            f"{RAG_URL}/rag/query/simple",
            json={"question": question, "mode": "sql", "top_k": top_k},
            headers=headers, timeout=60.0,
        )
        resp.raise_for_status()
        return resp.json()
    except httpx.HTTPStatusError as e:
        raise HTTPException(e.response.status_code, detail=e.response.text)
    except Exception as e:
        raise HTTPException(502, detail=f"RAG API unreachable: {e}")

def _strip_fences(text: str) -> str:
    return re.sub(r'^```[a-z]*\s*', '', text.strip(), flags=re.IGNORECASE).rstrip('`').strip()

def _extract_tables(sql: str) -> list[str]:
    return list(set(re.findall(r'\bFROM\s+(\w+)', sql, re.IGNORECASE)))

# ── Endpoints ────────────────────────────────────────────────────────────────

@app.get("/health", tags=["Health"])
def health():
    rag_ok = False
    try:
        r = httpx.get(f"{RAG_URL}/health", timeout=5)
        rag_ok = r.status_code == 200
    except Exception:
        pass
    return {"status": "ok", "rag_backend": "ok" if rag_ok else "unreachable"}


@app.get("/ehr/tables", tags=["Schema"], summary="List queryable tables")
def list_tables():
    try:
        client = boto3.client("dynamodb", region_name=REGION)
        tables = client.list_tables()["TableNames"]
        healthcare = [t for t in tables if not t.startswith("rag-")]
        return {"tables": healthcare, "rag_internal": [t for t in tables if t.startswith("rag-")]}
    except Exception as e:
        return {"tables": ["medications", "conditions", "observations", "patients", "encounters"],
                "note": f"Could not query DynamoDB live ({e}) — showing defaults"}


@app.post("/ehr/query", response_model=QueryResponse, tags=["NL Query"],
    summary="Translate natural language to Athena SQL")
def nl_to_partiql(body: NLQueryRequest) -> QueryResponse:
    data = _rag_sql(body.question, body.top_k)
    partiql = _strip_fences(data.get("answer", ""))
    explain_data = _rag_sql(f"In one sentence, explain what this query does: {partiql}", top_k=1)
    explanation = explain_data.get("answer", "Query generated from natural language.")
    return QueryResponse(
        question=body.question,
        partiql=partiql,
        explanation=explanation,
        tables_referenced=_extract_tables(partiql),
        latency_ms=data.get("latency_ms", 0),
        tokens_total=data.get("tokens", {}).get("total", 0),
    )


@app.post("/ehr/query/execute", response_model=ExecuteResponse, tags=["NL Query"],
    summary="Execute SQL via Amazon Athena + Glue Data Catalog",
    description="Runs the supplied SQL SELECT through Athena (supports JOINs). Only SELECT statements are permitted.")
def execute_partiql(body: ExecuteRequest) -> ExecuteResponse:
    stmt = body.partiql.strip()
    if not re.match(r'^\s*SELECT\b', stmt, re.IGNORECASE):
        raise HTTPException(400, detail="Only SELECT statements are permitted")
    glue_db = os.getenv("GLUE_DATABASE", "healthcare_data_lake")
    s3_out  = f"s3://{os.getenv('STAGING_BUCKET', 'dgs-glue-staging')}/athena-results/"
    t0 = time.time()
    try:
        client = boto3.client("athena", region_name=REGION)
        resp = client.start_query_execution(
            QueryString=stmt,
            QueryExecutionContext={"Database": glue_db},
            ResultConfiguration={"OutputLocation": s3_out},
        )
        qid = resp["QueryExecutionId"]
        for _ in range(30):
            status = client.get_query_execution(QueryExecutionId=qid)
            state  = status["QueryExecution"]["Status"]["State"]
            if state == "SUCCEEDED":
                break
            if state in ("FAILED", "CANCELLED"):
                reason = status["QueryExecution"]["Status"].get("StateChangeReason", "")
                raise HTTPException(502, detail=f"Athena {state}: {reason}")
            time.sleep(2)
        else:
            raise HTTPException(504, detail="Athena query timed out after 60 s")
        paginator = client.get_paginator("get_query_results")
        rows, headers = [], None
        for page in paginator.paginate(QueryExecutionId=qid):
            for row in page["ResultSet"]["Rows"]:
                values = [c.get("VarCharValue", "") for c in row["Data"]]
                if headers is None:
                    headers = values
                elif len(rows) < body.limit:
                    rows.append(dict(zip(headers, values)))
        truncated = len(rows) >= body.limit
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, detail=str(e))
    return ExecuteResponse(
        partiql=stmt,
        rows=rows,
        count=len(rows),
        truncated=truncated,
        latency_ms=int((time.time() - t0) * 1000),
    )


@app.post("/ehr/query/explain", tags=["NL Query"], summary="Explain a natural-language question")
def explain_query(body: NLQueryRequest) -> dict:
    headers = {"Content-Type": "application/json"}
    if JWT:
        headers["Authorization"] = f"Bearer {JWT}"
    try:
        resp = httpx.post(
            f"{RAG_URL}/rag/query/simple",
            json={"question": f"Explain in plain English what data this question retrieves: '{body.question}'",
                  "mode": "standard", "top_k": body.top_k},
            headers=headers, timeout=60.0,
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        raise HTTPException(502, detail=str(e))
    return {"question": body.question, "explanation": data.get("answer", ""),
            "latency_ms": data.get("latency_ms", 0)}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("ehr_query:app", host="0.0.0.0",
                port=int(os.getenv("PORT", "4007")), reload=True)
