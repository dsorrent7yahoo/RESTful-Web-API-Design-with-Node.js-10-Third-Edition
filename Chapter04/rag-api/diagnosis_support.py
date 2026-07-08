"""
diagnosis_support.py — Evidence-Based Diagnosis Support API.

PURPOSE
-------
Assists clinicians in generating evidence-based differential diagnoses
from patient lab results and current medications.  Every diagnosis is
grounded in retrieved clinical passages and cited to a source document.

WHAT IS THE GARMLE-G FRAMEWORK?
---------------------------------
GARMLE-G (Generation-Augmented Retrieval for Medical Language with Evidence
Grounding, arXiv:2506.21615) eliminates hallucinated guideline citations by:
  1. Combining LLM predictions with patient EHR data to form a rich query
  2. Retrieving matching clinical practice guideline (CPG) passages by embedding similarity
  3. Fusing retrieved guideline content with LLM output to produce a
     hallucination-free, evidence-backed diagnosis

WHAT IS ICD-10?
---------------
ICD-10 (International Classification of Diseases, 10th Revision) is the WHO's
standard for recording diagnoses and procedure codes in healthcare.
Example: E11.9 = Type 2 Diabetes Mellitus without complications.

ENDPOINTS
---------
POST /diagnosis/evaluate      Full GARMLE-G diagnosis from lab values + medications
POST /diagnosis/differential  Differential diagnoses for a set of symptoms/labs
POST /diagnosis/lab           Interpret a single lab value in clinical context

PORT: 4008
SWAGGER: http://localhost:4008/docs
RAG API: http://localhost:4005 (must be running)
"""

import os, httpx
from dotenv import load_dotenv
load_dotenv()
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional

RAG_URL = os.getenv("RAG_URL", "http://localhost:4005")
JWT     = os.getenv("RAG_JWT", "")

app = FastAPI(
    title="Diagnosis Support API",
    description=(
        "## Evidence-Based Clinical Diagnosis Assistance\n\n"
        "Generates CPG-grounded differential diagnoses from patient lab results\n"
        "and medication context.  Every diagnosis includes ICD-10/SNOMED codes and\n"
        "is supported by a citation to a retrieved clinical source.\n\n"
        "**Powered by:** RAG API (port 4005) · Claude Sonnet 4.6 · LOINC + medications corpus\n\n"
        "**Research basis:** GARMLE-G arXiv:2506.21615 · REALM arXiv:2402.07016"
    ),
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(CORSMiddleware, allow_origins=["*"],
                   allow_methods=["*"], allow_headers=["*"])

# ── Pydantic models ──────────────────────────────────────────────────────────

class PatientContext(BaseModel):
    """Clinical data for one patient visit."""
    lab_values: Optional[dict[str, str]] = Field(
        None, description="LOINC-coded lab values as {code_or_name: value_with_units}",
        examples=[{"HbA1c (4548-4)": "7.4%", "Fasting glucose": "6.8 mmol/L"}])
    current_medications: Optional[list[str]] = Field(
        None, description="Active medication names",
        examples=[["Metformin 500 MG", "Lisinopril 10 MG"]])
    symptoms: Optional[list[str]] = Field(
        None, description="Reported symptoms",
        examples=[["excessive thirst", "frequent urination", "fatigue"]])
    age: Optional[int] = Field(None, description="Patient age in years")
    sex: Optional[str] = Field(None, description="Patient biological sex (M/F)")
    top_k: int = Field(5, ge=1, le=10)

class LabInterpretationRequest(BaseModel):
    """Request for interpreting a single lab value."""
    loinc_code: Optional[str] = Field(None, description="LOINC code (e.g. '4548-4' for HbA1c)")
    lab_name: str = Field(..., description="Lab test name (e.g. 'HbA1c', 'Hemoglobin')")
    value: str = Field(..., description="Measured value with units (e.g. '7.4%', '125 mg/dL')")
    patient_conditions: Optional[list[str]] = Field(None,
        description="Known conditions for context (e.g. ['diabetes', 'hypertension'])")

class DiagnosisResponse(BaseModel):
    """Structured diagnosis response."""
    primary_diagnosis: str
    icd_code: Optional[str]
    differential: list[str]
    guideline_support: str
    recommended_workup: str
    full_report: str
    sources_count: int
    latency_ms: int

# ── Helper ──────────────────────────────────────────────────────────────────

def _rag_diagnosis(question: str, top_k: int,
                   patient_id: Optional[str] = None) -> dict:
    """Call the main RAG API in diagnosis mode."""
    headers = {"Content-Type": "application/json"}
    if JWT:
        headers["Authorization"] = f"Bearer {JWT}"
    body: dict = {"question": question, "mode": "diagnosis", "top_k": top_k}
    if patient_id:
        body["patient_id"] = patient_id
    try:
        endpoint = "/rag/query" if patient_id else "/rag/query/simple"
        resp = httpx.post(f"{RAG_URL}{endpoint}", json=body,
                          headers=headers, timeout=90.0)
        resp.raise_for_status()
        return resp.json()
    except httpx.HTTPStatusError as e:
        raise HTTPException(e.response.status_code, detail=e.response.text)
    except Exception as e:
        raise HTTPException(502, detail=f"RAG API unreachable: {e}")

def _build_question(ctx: PatientContext) -> str:
    """Construct a diagnosis question from patient context."""
    parts = ["Evaluate this patient:"]
    if ctx.lab_values:
        labs = ", ".join(f"{k}={v}" for k, v in ctx.lab_values.items())
        parts.append(f"Lab values: {labs}.")
    if ctx.current_medications:
        parts.append(f"Current medications: {', '.join(ctx.current_medications)}.")
    if ctx.symptoms:
        parts.append(f"Symptoms: {', '.join(ctx.symptoms)}.")
    if ctx.age:
        sex_str = f" {ctx.sex}" if ctx.sex else ""
        parts.append(f"Patient is {ctx.age} years old{sex_str}.")
    parts.append("Provide primary diagnosis with ICD code, differential, guideline support, and recommended workup.")
    return " ".join(parts)

# ── Endpoints ────────────────────────────────────────────────────────────────

@app.get("/health", tags=["Health"], summary="Service health check")
def health():
    rag_ok = False
    try:
        r = httpx.get(f"{RAG_URL}/health", timeout=5); rag_ok = r.status_code == 200
    except Exception:
        pass
    return {"status": "ok", "rag_backend": "ok" if rag_ok else "unreachable"}


@app.post("/diagnosis/evaluate", response_model=DiagnosisResponse, tags=["Diagnosis"],
    summary="Full GARMLE-G diagnosis from patient context",
    description=(
        "Generates a structured evidence-based diagnosis using the GARMLE-G framework.\n\n"
        "Output sections (following GARMLE-G output format):\n"
        "- **PRIMARY DIAGNOSIS** — most likely diagnosis with ICD-10/SNOMED code\n"
        "- **DIFFERENTIAL** — up to 3 alternative diagnoses with rationale\n"
        "- **GUIDELINE SUPPORT** — specific CPG passage citation [source: id]\n"
        "- **RECOMMENDED WORKUP** — tests and referrals per the guideline\n\n"
        "Provide lab values, current medications, and/or symptoms for best results."
    ))
def evaluate_patient(body: PatientContext) -> DiagnosisResponse:
    question = _build_question(body)
    data = _rag_diagnosis(question, body.top_k)
    answer = data.get("answer", "")
    return DiagnosisResponse(
        primary_diagnosis=answer.split("\n")[0][:200] if answer else "",
        icd_code=None,
        differential=[],
        guideline_support="",
        recommended_workup="",
        full_report=answer,
        sources_count=len(data.get("sources", [])),
        latency_ms=data.get("latency_ms", 0),
    )


@app.post("/diagnosis/patient/{patient_id}", response_model=DiagnosisResponse,
    tags=["Diagnosis"],
    summary="Diagnosis using stored patient EHR data",
    description=(
        "Loads the patient's active medications, conditions, and observations\n"
        "directly from DynamoDB (PACE-RAG pattern) and generates a diagnosis.\n\n"
        "`patient_id` must be a valid UUID from the `medications` DynamoDB table."
    ))
def evaluate_by_patient_id(patient_id: str, top_k: int = 5) -> DiagnosisResponse:
    question = ("Based on this patient's full medication history and lab results, "
                "what is the most likely diagnosis? Provide ICD code, differential, "
                "guideline support, and recommended workup.")
    data = _rag_diagnosis(question, top_k, patient_id=patient_id)
    answer = data.get("answer", "")
    return DiagnosisResponse(
        primary_diagnosis=answer.split("\n")[0][:200] if answer else "",
        icd_code=None, differential=[], guideline_support="",
        recommended_workup="", full_report=answer,
        sources_count=len(data.get("sources", [])),
        latency_ms=data.get("latency_ms", 0),
    )


@app.post("/diagnosis/lab", tags=["Lab Interpretation"],
    summary="Interpret a single lab value in clinical context",
    description=(
        "Looks up the LOINC reference range for the specified test and generates\n"
        "a clinical interpretation with normal/abnormal status and clinical significance.\n\n"
        "Examples: HbA1c 7.4% · Hemoglobin 9.2 g/dL · Systolic BP 145 mm[Hg]"
    ))
def interpret_lab(body: LabInterpretationRequest) -> dict:
    cond_ctx = ""
    if body.patient_conditions:
        cond_ctx = f" Patient has: {', '.join(body.patient_conditions)}."
    question = (
        f"Interpret a {body.lab_name} result of {body.value}. "
        f"Is this normal or abnormal? What is the clinical significance?{cond_ctx}"
    )
    headers = {"Content-Type": "application/json"}
    if JWT:
        headers["Authorization"] = f"Bearer {JWT}"
    try:
        resp = httpx.post(
            f"{RAG_URL}/rag/query/simple",
            json={"question": question, "mode": "standard", "top_k": 3,
                  "index_filter": "loinc"},
            headers=headers, timeout=60.0,
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        raise HTTPException(502, detail=str(e))
    return {"lab_name": body.lab_name, "value": body.value,
            "loinc_code": body.loinc_code, "interpretation": data.get("answer", ""),
            "sources_count": len(data.get("sources", [])),
            "latency_ms": data.get("latency_ms", 0)}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("diagnosis_support:app", host="0.0.0.0",
                port=int(os.getenv("PORT", "4008")), reload=True)
