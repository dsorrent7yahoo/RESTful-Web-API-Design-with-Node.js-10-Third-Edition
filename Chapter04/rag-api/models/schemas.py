"""
models/schemas.py — Pydantic request and response models for all API endpoints.

PURPOSE
-------
Defines the exact shape of every JSON body sent to and received from the API.
FastAPI uses these classes to:
  1. Validate incoming request bodies (wrong types → automatic HTTP 422)
  2. Serialise outgoing responses to JSON
  3. Generate Swagger UI parameter forms and example bodies

WHAT IS PYDANTIC?
-----------------
Pydantic is a data validation library.  A class that inherits BaseModel
automatically checks that assigned values match the declared Python types.
If a request sends {"top_k": "five"} instead of {"top_k": 5}, Pydantic
raises a validation error before your code even runs.

CLASSES — QUERY
---------------
RAGQueryRequest
    Full query body.  Includes optional patient_id for PACE-RAG patient-aware
    retrieval (arXiv:2603.17356) and optional index_filter to restrict to one
    corpus shard (medications, fda-labels, snomed, loinc, guidelines).

RAGQueryRequestSimple
    ID-free query body.  Only question + mode + top_k.
    No patient_id, no index_filter — searches all shards anonymously.

RAGQueryResponse
    Returned for every query.  Contains answer text, source passages with
    relevance scores, token usage, and latency.

RAGQueryResponseSimple
    Like RAGQueryResponse but omits the patient_id field.

SourcePassage
    One retrieved passage that was injected into the LLM prompt.
    Fields: id (document ID in the vector store), text (passage text),
    source (human-readable origin label), score (cosine similarity 0–1).

TokenUsage
    LLM token counts: prompt tokens, completion tokens, total.

CLASSES — INDEXING
------------------
IndexMedicationsRequest  Index medications table by table_name / patient_id / limit.
IndexFDARequest          Index FDA drug labels from a named DynamoDB table.
IndexSNOMEDRequest       Index SNOMED CT concepts from a conditions table.
IndexLOINCRequest        Index LOINC observation codes from an observations table.
IndexGuidelineRequest    Download and index a PDF or HTML clinical guideline.
IndexRequestSimple       Index default corpus with no table_name or patient_id.
IndexJobResponse         Response to any POST /rag/index/* call: {status, job_id, message}.

CLASSES — JOBS
--------------
JobStatusResponse   Poll GET /rag/jobs/{job_id}.  Fields: status (queued/running/done/error),
                    documents_done, documents_total, started_at, finished_at, error.

CLASSES — MODELS
----------------
ModelConfig         Register a new named pipeline: name, label, embed_backend,
                    llm_backend, llm_model, shard_filter, top_k, alpha, description.
ModelStatus         Current state of a named model: is_active, test_pass, last_tested,
                    doc_count, plus all ModelConfig fields.
ModelTestRequest    Body for POST /rag/models/{name}/test: list of questions + mode.
ModelTestRequestSimple  Test with no custom questions — uses built-in defaults.
ModelTestResult     One test result: question, answer, sources_count, latency_ms,
                    tokens_total, error.
IndexStatusResponse  Response for GET /rag/index/status: backend, shards dict, total_docs.
ShardStatus          Per-shard stats: doc_count, last_indexed timestamp.
"""

from __future__ import annotations
from typing import Dict, Literal, Optional
from pydantic import BaseModel, Field

class RAGQueryRequest(BaseModel):
    question: str = Field(..., min_length=3)
    patient_id: Optional[str] = None
    mode: Literal["standard","copilot","sql","diagnosis"] = "standard"
    top_k: int = Field(5, ge=1, le=20)
    index_filter: Optional[str] = None

class SourcePassage(BaseModel):
    id: str; text: str; source: str; score: float

class TokenUsage(BaseModel):
    prompt: int; completion: int; total: int

class RAGQueryResponse(BaseModel):
    answer: str
    sources: list[SourcePassage]
    mode: str
    patient_id: Optional[str]
    tokens: TokenUsage
    latency_ms: int

class IndexMedicationsRequest(BaseModel):
    table_name: str = "medications"
    batch_size: int = Field(100, ge=1, le=500)
    limit: int = Field(500, ge=0, description="Max records to index (0=all). Default 500 for fast demo.")
    patient_id: Optional[str] = None

class IndexFDARequest(BaseModel):
    table_name: str = "medications"

class IndexSNOMEDRequest(BaseModel):
    table_name: str = "conditions"
    umls_api_key: Optional[str] = None

class IndexLOINCRequest(BaseModel):
    table_name: str = "observations"
    loinc_csv_path: Optional[str] = None

class IndexGuidelineRequest(BaseModel):
    url: str
    source_label: str
    chunk_size: int = Field(400, ge=100, le=1000)
    overlap: int = Field(50, ge=0, le=200)

class IndexJobResponse(BaseModel):
    status: str; job_id: str; message: str

class ShardStatus(BaseModel):
    doc_count: int; last_indexed: Optional[str]

class IndexStatusResponse(BaseModel):
    backend: str
    shards: Dict[str, ShardStatus]
    total_docs: int
    embedder: str
    dimension: int


# ── ID-free variants (no patient_id, no index_filter required) ───────────────

class RAGQueryRequestSimple(BaseModel):
    """Simplified query — no patient context, no shard restriction.
    Use this when you want a clinical answer without linking to a specific patient.
    """
    question: str = Field(..., min_length=3, description="Natural-language clinical question")
    mode: Literal["standard","copilot","sql","diagnosis"] = Field(
        "standard", description="Generation mode")
    top_k: int = Field(5, ge=1, le=20, description="Passages to retrieve")

class RAGQueryResponseSimple(BaseModel):
    """Response without patient-linked fields."""
    answer: str
    sources: list[SourcePassage]
    mode: str
    tokens: TokenUsage
    latency_ms: int

class IndexRequestSimple(BaseModel):
    """Trigger corpus indexing without specifying a table — uses env-var defaults."""
    batch_size: int = Field(100, ge=1, le=500)
    limit: int = Field(500, ge=0,
                       description="Max records (0=all). Default 500 for fast demo.")

class ModelTestRequestSimple(BaseModel):
    """Test a model with default clinical questions — no IDs needed."""
    mode: Literal["standard","copilot","sql","diagnosis"] = "standard"

# ── /rag/models/* ─────────────────────────────────────────────────────────────

class ModelConfig(BaseModel):
    name: str = Field(..., description="Unique model name: e.g. 'main', 'test', 'staging'")
    label: str = Field(..., description="Human-readable label shown in Swagger / UI")
    embed_backend: str = Field("clinicalbert", description="clinicalbert | openai | bedrock")
    llm_backend: str = Field("bedrock", description="openai | bedrock | ollama")
    llm_model: str = Field("amazon.nova-pro-v1:0",
                           description="Bedrock model/profile ID or OpenAI model name")
    shard_filter: Optional[str] = Field(
        None, description="Restrict queries to one index shard: medications | fda-labels | snomed | loinc | guidelines")
    top_k: int = Field(5, ge=1, le=20, description="Default retrieved passages for this model")
    alpha: float = Field(0.6, ge=0.0, le=1.0,
                         description="Hybrid weight: 0=BM25 only, 1=dense only")
    description: str = Field("", description="Optional notes, e.g. corpus size, intended use")

class ModelTestRequest(BaseModel):
    questions: list[str] = Field(
        default=["What is Metformin prescribed for?",
                 "Normal HbA1c reference range?",
                 "Find patients on Warfarin"],
        description="List of test questions to run against this model",
        max_length=10)
    mode: Literal["standard","copilot","sql","diagnosis"] = "standard"

class ModelTestResult(BaseModel):
    question: str
    answer: str
    sources_count: int
    latency_ms: int
    tokens_total: int
    error: Optional[str]

class ModelStatus(BaseModel):
    name: str
    label: str
    is_active: bool
    embed_backend: str
    llm_backend: str
    llm_model: str
    shard_filter: Optional[str]
    top_k: int
    alpha: float
    description: str
    created_at: str
    last_tested: Optional[str]
    test_pass: Optional[bool]
    doc_count: int

class JobStatusResponse(BaseModel):
    job_id: str; shard: str
    status: Literal["queued","running","done","error"]
    documents_done: int; documents_total: int
    error: Optional[str]; started_at: Optional[str]; finished_at: Optional[str]
