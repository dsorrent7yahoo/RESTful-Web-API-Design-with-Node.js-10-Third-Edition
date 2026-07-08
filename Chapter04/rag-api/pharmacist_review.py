# Databricks notebook source
"""
pharmacist_review.py — Pharmacist Clinical Decision Support API.

PURPOSE
-------
A focused FastAPI service for pharmacists reviewing medications for drug-related
problems (DRPs).  Wraps the RAG API in a domain-specific interface with
purpose-built request/response schemas.

WHAT IS A DRP?
--------------
A Drug-Related Problem (DRP) is any undesired event experienced by a patient
that involves drug therapy and that interferes with achieving the desired goals
of therapy.  The PCNE (Pharmaceutical Care Network Europe) classification system
categorises DRPs by:
  Problem    — what went wrong (adverse reaction, untreated condition, etc.)
  Cause      — why it happened (wrong drug, wrong dose, drug interaction)
  Intervention — what the pharmacist should do
  Severity   — NCC MERP index A–I (A=near miss, I=death)

ENDPOINTS
---------
POST /review/patient/{patient_id}   Full DRP review for all active medications
POST /review/medication              Review one drug name for interactions/warnings
POST /review/interaction             Check interactions between two or more drugs

PORT: 4006
SWAGGER: http://localhost:4006/docs
RAG API: http://localhost:4005 (must be running)
"""

import os, httpx
from dotenv import load_dotenv
load_dotenv()
from fastapi import FastAPI, HTTPException, Path
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional

RAG_URL = os.getenv("RAG_URL", "http://localhost:4005")
JWT     = os.getenv("RAG_JWT", "")   # set RAG_JWT env var with a valid token

app = FastAPI(
    title="Pharmacist Review API",
    description=(
        "## Clinical Decision Support for Pharmacists\n\n"
        "Identifies Drug-Related Problems (DRPs) using FDA drug label data and\n"
        "patient medication records.  Every finding is grounded in a retrieved\n"
        "FDA label passage and cited with [source: id] notation.\n\n"
        "**Powered by:** RAG API (port 4005) · Claude Sonnet 4.6 · FDA OpenFDA corpus\n\n"
        "**Research basis:** RAG-CDSS arXiv:2402.01741 (PCNE DRP classification)"
    ),
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(CORSMiddleware, allow_origins=["*"],
                   allow_methods=["*"], allow_headers=["*"])

# ── Pydantic models ──────────────────────────────────────────────────────────

class DRPReviewRequest(BaseModel):
    """Request body for reviewing a single medication."""
    drug_name: str = Field(..., description="Drug name as it appears in the prescription (e.g. 'Warfarin Sodium 5 MG')")
    patient_conditions: Optional[list[str]] = Field(
        None, description="Known patient conditions to personalise the review (e.g. ['hypertension', 'diabetes'])")
    top_k: int = Field(4, ge=1, le=10, description="Number of FDA label passages to retrieve")

class InteractionCheckRequest(BaseModel):
    """Request body for checking interactions between two or more drugs."""
    drugs: list[str] = Field(..., min_length=2,
        description="List of 2+ drug names to check for interactions",
        examples=[["Warfarin Sodium 5 MG", "Naproxen 500 MG"]])

class DRPSection(BaseModel):
    problem: str
    cause: str
    severity: str
    intervention: str
    sources: list[str]

class DRPReviewResponse(BaseModel):
    drug_name: str
    answer: str
    sections: Optional[DRPSection]
    sources_count: int
    sources: list[str]
    latency_ms: int
    tokens_total: int

# ── Helper ──────────────────────────────────────────────────────────────────

def _rag(question: str, top_k: int = 4, index_filter: str = "fda-labels") -> dict:
    """Call the main RAG API in copilot mode and return the response dict."""
    headers = {"Content-Type": "application/json"}
    if JWT:
        headers["Authorization"] = f"Bearer {JWT}"
    try:
        resp = httpx.post(
            f"{RAG_URL}/rag/query/simple",
            json={"question": question, "mode": "copilot", "top_k": top_k,
                  "index_filter": index_filter},
            headers=headers, timeout=60.0,
        )
        resp.raise_for_status()
        return resp.json()
    except httpx.HTTPStatusError as e:
        raise HTTPException(e.response.status_code, detail=e.response.text)
    except Exception as e:
        raise HTTPException(502, detail=f"RAG API unreachable: {e}")

# ── Endpoints ────────────────────────────────────────────────────────────────

@app.get("/health", tags=["Health"], summary="Service health check")
def health():
    """Check that the Pharmacist Review API and its RAG backend are reachable."""
    rag_ok = False
    try:
        r = httpx.get(f"{RAG_URL}/health", timeout=5)
        rag_ok = r.status_code == 200
    except Exception:
        pass
    return {"status": "ok", "rag_backend": "ok" if rag_ok else "unreachable",
            "rag_url": RAG_URL}


@app.post("/review/medication", response_model=DRPReviewResponse, tags=["DRP Review"],
    summary="Review one medication for DRPs",
    description=(
        "Retrieves FDA drug label passages (drug interactions, warnings, contraindications)\n"
        "for the named drug and generates a structured PCNE DRP report.\n\n"
        "Add `patient_conditions` to personalise the review — the query is augmented\n"
        "with the patient's condition list before FDA label retrieval."
    ))
def review_medication(body: DRPReviewRequest) -> DRPReviewResponse:
    cond_ctx = ""
    if body.patient_conditions:
        cond_ctx = f" Patient has: {', '.join(body.patient_conditions)}."
    question = (
        f"Review {body.drug_name} — identify all drug-related problems, "
        f"drug interactions, contraindications, and recommended pharmacist interventions.{cond_ctx}"
    )
    data = _rag(question, body.top_k)
    raw_sources = data.get("sources", [])
    return DRPReviewResponse(
        drug_name=body.drug_name,
        answer=data.get("answer", ""),
        sections=None,  # parsed from answer in future versions
        sources_count=len(raw_sources),
        sources=[s.get("source", s.get("id", "")) for s in raw_sources],
        latency_ms=data.get("latency_ms", 0),
        tokens_total=data.get("tokens", {}).get("total", 0),
    )


@app.post("/review/patient/{patient_id}", response_model=DRPReviewResponse, tags=["DRP Review"],
    summary="Full DRP review for a patient's active medications",
    description=(
        "Looks up the patient's active medication records from DynamoDB, then\n"
        "retrieves FDA label DRP information for the combined drug regimen.\n\n"
        "`patient_id` must be a valid UUID from the `medications` DynamoDB table."
    ))
def review_patient(
    patient_id: str = Path(..., description="Patient UUID from the medications DynamoDB table"),
    top_k: int = 5,
) -> DRPReviewResponse:
    headers = {"Content-Type": "application/json"}
    if JWT:
        headers["Authorization"] = f"Bearer {JWT}"
    try:
        resp = httpx.post(
            f"{RAG_URL}/rag/query",
            json={"question": "Review all medications for this patient — identify drug-related problems, interactions, and contraindications",
                  "mode": "copilot", "top_k": top_k, "patient_id": patient_id},
            headers=headers, timeout=60.0,
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        raise HTTPException(502, detail=str(e))
    raw_sources = data.get("sources", [])
    return DRPReviewResponse(
        drug_name=f"Patient {patient_id[:8]}... (all active meds)",
        answer=data.get("answer", ""),
        sections=None,
        sources_count=len(raw_sources),
        sources=[s.get("source", s.get("id", "")) for s in raw_sources],
        latency_ms=data.get("latency_ms", 0),
        tokens_total=data.get("tokens", {}).get("total", 0),
    )


@app.post("/review/interaction", response_model=DRPReviewResponse, tags=["DRP Review"],
    summary="Check drug-drug interactions between 2 or more drugs",
    description=(
        "Checks for documented interactions between the supplied list of drug names\n"
        "using FDA drug label data from the fda-labels corpus shard.\n\n"
        "Pass 2 or more drug names.  The system retrieves FDA interaction passages\n"
        "for each drug and generates a combined DRP report."
    ))
def check_interaction(body: InteractionCheckRequest) -> DRPReviewResponse:
    drug_list = " AND ".join(body.drugs)
    question = (
        f"What are the drug-drug interactions, contraindications, and DRPs "
        f"when a patient is prescribed BOTH {drug_list} simultaneously?"
    )
    data = _rag(question, top_k=len(body.drugs) * 2)
    raw_sources = data.get("sources", [])
    return DRPReviewResponse(
        drug_name=drug_list,
        answer=data.get("answer", ""),
        sections=None,
        sources_count=len(raw_sources),
        sources=[s.get("source", s.get("id", "")) for s in raw_sources],
        latency_ms=data.get("latency_ms", 0),
        tokens_total=data.get("tokens", {}).get("total", 0),
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("pharmacist_review:app", host="0.0.0.0",
                port=int(os.getenv("PORT", "4006")), reload=True)
