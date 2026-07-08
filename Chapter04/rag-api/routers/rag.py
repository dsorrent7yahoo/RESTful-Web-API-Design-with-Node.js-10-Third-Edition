"""
routers/rag.py — FastAPI router for all /rag/* endpoints.

PURPOSE
-------
Exposes the RAG pipeline and corpus indexing operations as HTTP endpoints.
All endpoints except /rag/index/status and /rag/jobs/{job_id} require a
Bearer JWT in the Authorization header.

ENDPOINT GROUPS
---------------
QUERY (requires JWT)
  POST /rag/query              Full RAG query — optional patient_id, index_filter
  POST /rag/query/simple       ID-free query — question + mode + top_k only

INDEXING (requires JWT) — all return 202 Accepted immediately
  POST /rag/index/medications  Scan DynamoDB medications table → embed → index
  POST /rag/index/fda-labels   Fetch FDA labels → chunk → embed → index
  POST /rag/index/snomed       Fetch SNOMED concepts from UMLS → embed → index
  POST /rag/index/loinc        Index LOINC codes (16 built-in + optional CSV)
  POST /rag/index/guidelines   Download PDF/HTML → chunk → embed → index
  POST /rag/index/simple       Index default table with no IDs required

STATUS (open — no JWT required)
  GET  /rag/index/status       Per-shard doc counts, dimension, backend
  GET  /rag/jobs/{job_id}      Background job status (queued/running/done/error)

ADMIN (requires JWT + role=admin)
  DELETE /rag/index            Delete all docs or one named shard

BACKGROUND JOBS
---------------
All indexing endpoints return immediately with a job_id.
The actual indexing runs in FastAPI BackgroundTasks (a thread pool).
Poll GET /rag/jobs/{job_id} to see progress.

JOB LIFECYCLE:  queued → running → done | error

SINGLETONS
----------
_embedder, _store, _pipeline are module-level singletons initialised lazily on
the first request.  _get_pipeline() / _get_e() / _get_s() return these.

_jobs: dict[str, dict]  In-memory job tracker (reset on server restart).

FUNCTIONS (module-level helpers)
---------------------------------
_get_pipeline() -> RAGPipeline   Lazy singleton for the active RAG pipeline.
_get_e() -> Embedder             Returns the singleton embedder.
_get_s() -> VectorStore          Returns the singleton vector store.
_new_job(shard, total) -> str    Creates a new job entry and returns its job_id.
_finish(jid, count)              Marks a job done with final document count.
_fail(jid, exc)                  Marks a job as errored with exception message.
"""

import time, uuid
from typing import Optional
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from auth import require_jwt
from config import settings
from models.schemas import (RAGQueryRequest, RAGQueryRequestSimple,
                             RAGQueryResponse, RAGQueryResponseSimple,
                             SourcePassage, TokenUsage,
                             IndexRequestSimple, ModelTestRequestSimple,
                             IndexMedicationsRequest, IndexFDARequest, IndexSNOMEDRequest,
                             IndexLOINCRequest, IndexGuidelineRequest, IndexJobResponse,
                             IndexStatusResponse, ShardStatus, JobStatusResponse)
from rag.embedder import Embedder
from rag.vector_store import VectorStore
from rag.retriever import HybridRetriever
from rag.generator import Generator
from rag.pipeline import RAGPipeline
from rag.corpus.medication_indexer import MedicationIndexer
from rag.corpus.fda_label_loader import FDALabelLoader
from rag.corpus.snomed_loader import SNOMEDLoader
from rag.corpus.loinc_loader import LOINCLoader
from rag.corpus.guideline_loader import GuidelineLoader

router = APIRouter()
_embedder = None; _store = None; _pipeline = None; _jobs = {}

def _get_pipeline():
    global _embedder, _store, _pipeline
    if _pipeline is None:
        _embedder = Embedder(settings.rag_embed_backend)
        _store = VectorStore(settings.rag_vector_backend, settings.rag_opensearch_index)
        _pipeline = RAGPipeline(_embedder, HybridRetriever(_embedder, _store, settings.rag_alpha),
                                Generator(settings.rag_llm_backend))
    return _pipeline

def _get_e(): _get_pipeline(); return _embedder
def _get_s(): _get_pipeline(); return _store

def _new_job(shard, total=0):
    jid = str(uuid.uuid4())[:8]
    _jobs[jid] = {"job_id":jid,"shard":shard,"status":"queued","documents_done":0,
                  "documents_total":total,"error":None,
                  "started_at":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),
                  "finished_at":None}
    return jid

def _finish(jid, count):
    _jobs[jid].update({"status":"done","documents_done":count,
                        "finished_at":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime())})

def _fail(jid, exc):
    _jobs[jid].update({"status":"error","error":str(exc),
                        "finished_at":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime())})


# ── POST /rag/query/simple  — no patient_id, no index_filter ─────────────────
@router.post(
    "/query/simple",
    response_model=RAGQueryResponseSimple,
    summary="Clinical Query (no patient ID)",
    description=(
        "Ask a clinical question **without** linking to a patient record or restricting\n"
        "to a specific index shard. All indexed corpora are searched.\n\n"
        "Use `POST /rag/query` when you also want patient-aware (PACE-RAG) retrieval.\n\n"
        "**Modes:** `standard` · `copilot` · `sql` · `diagnosis`"
    ),
    tags=["RAG — ID-Free"]
)
def rag_query_simple(body: RAGQueryRequestSimple, _: dict = Depends(require_jwt)):
    pipeline = _get_pipeline()
    try:
        r = pipeline.query(body.question, patient_id=None,
                           mode=body.mode, top_k=body.top_k, shard_filter=None)
    except Exception as e:
        raise HTTPException(502, detail=f"RAG error: {e}")
    return RAGQueryResponseSimple(
        answer=r["answer"],
        sources=[SourcePassage(id=s["id"], text=s["text"],
                               source=s["source"], score=s["score"])
                 for s in r.get("sources", [])],
        mode=r["mode"],
        tokens=TokenUsage(**r.get("tokens", {"prompt": 0, "completion": 0, "total": 0})),
        latency_ms=r.get("latency_ms", 0))


# ── POST /rag/index/simple  — index medications without specifying table name ──
@router.post(
    "/index/simple",
    response_model=IndexJobResponse,
    status_code=202,
    summary="Index Default Corpus (no table ID required)",
    description=(
        "Trigger medication indexing using environment-variable defaults — "
        "no `table_name` or `patient_id` required.\n\n"
        "Internally calls `POST /rag/index/medications` with `table_name` from "
        "`DYNAMODB_TABLE` env var (default: `medications`).\n\n"
        "Use `POST /rag/index/medications` when you need to specify a custom table."
    ),
    tags=["RAG — ID-Free"]
)
def index_simple(body: IndexRequestSimple, bg: BackgroundTasks, _: dict = Depends(require_jwt)):
    from config import settings
    jid = _new_job("medications", body.limit or 371806)
    job = _jobs[jid]
    def run():
        job["status"] = "running"
        try:
            from rag.corpus.medication_indexer import MedicationIndexer
            idx = MedicationIndexer(_get_e(), _get_s(), settings.dynamodb_table)
            cnt = idx.index_all(body.batch_size, body.limit, job_ref=job)
            _finish(jid, cnt)
        except Exception as e:
            _fail(jid, e)
    bg.add_task(run)
    return IndexJobResponse(
        status="queued", job_id=jid,
        message=f"Indexing up to {body.limit or 'ALL'} records from "
                f"'{settings.dynamodb_table}'. Poll GET /rag/jobs/{jid}")


# ── POST /rag/query ────────────────────────────────────────────────────────────
@router.post("/query", response_model=RAGQueryResponse,
             summary="Clinical RAG Query",
             description=(
                 "Ask a clinical question answered from indexed corpora.\n\n"
                 "**Modes:**\n"
                 "- `standard` — direct grounded answer\n"
                 "- `copilot` — PCNE Drug-Related Problem report (arXiv:2402.01741)\n"
                 "- `sql` — natural language → DynamoDB PartiQL (arXiv:2603.05569)\n"
                 "- `diagnosis` — CPG-grounded differential diagnosis (arXiv:2506.21615)\n\n"
                 "Set `patient_id` to enable PACE-RAG patient-aware retrieval (arXiv:2603.17356).\n\n"
                 "**index_filter values:** `medications` · `fda-labels` · `snomed` · `loinc` · `guidelines`"
             ))
def rag_query(body: RAGQueryRequest, _: dict = Depends(require_jwt)):
    pipeline = _get_pipeline()
    try:
        r = pipeline.query(body.question, body.patient_id, body.mode, body.top_k, body.index_filter)
    except Exception as e:
        raise HTTPException(502, detail=f"RAG pipeline error: {e}")
    return RAGQueryResponse(
        answer=r["answer"],
        sources=[SourcePassage(id=s["id"],text=s["text"],source=s["source"],score=s["score"])
                 for s in r.get("sources",[])],
        mode=r["mode"], patient_id=r.get("patient_id"),
        tokens=TokenUsage(**r.get("tokens",{"prompt":0,"completion":0,"total":0})),
        latency_ms=r.get("latency_ms",0))

# ── POST /rag/index/medications ────────────────────────────────────────────────
@router.post("/index/medications", response_model=IndexJobResponse, status_code=202,
             summary="Index Medications Table",
             description=(
                 "Scans DynamoDB `medications` table and embeds each record with ClinicalBERT.\n\n"
                 "**`limit`** controls how many records to index (default 500 for fast demo; "
                 "set to 0 for all 371 806 records — takes ~30 min on CPU).\n\n"
                 "Returns 202 immediately. Poll `GET /rag/jobs/{job_id}` for live progress."
             ))
def index_medications(body: IndexMedicationsRequest, bg: BackgroundTasks, _: dict = Depends(require_jwt)):
    jid = _new_job("medications", body.limit or 371806)
    job = _jobs[jid]
    def run():
        job["status"] = "running"
        try:
            idx = MedicationIndexer(_get_e(), _get_s(), body.table_name)
            if body.patient_id:
                cnt = idx.index_by_patient(body.patient_id, job_ref=job)
            else:
                cnt = idx.index_all(body.batch_size, body.limit, job_ref=job)
            _finish(jid, cnt)
        except Exception as e:
            _fail(jid, e)
    bg.add_task(run)
    limit_str = f"{body.limit:,}" if body.limit else "ALL"
    return IndexJobResponse(status="queued", job_id=jid,
                            message=f"Indexing {limit_str} records from {body.table_name}. Poll GET /rag/jobs/{jid}")

# ── POST /rag/index/fda-labels ─────────────────────────────────────────────────
@router.post("/index/fda-labels", response_model=IndexJobResponse, status_code=202,
             summary="Index FDA Drug Labels",
             description=(
                 "Fetches drug labels from `api.fda.gov/drug/label.json` for every unique "
                 "drug description in the medications table. Indexes 8 label sections per drug.\n\n"
                 "Free API — no key required (1 000 req/day). "
                 "Set `FDA_API_KEY` env var for 120 000 req/day."
             ))
def index_fda(body: IndexFDARequest, bg: BackgroundTasks, _: dict = Depends(require_jwt)):
    jid = _new_job("fda-labels")
    def run():
        _jobs[jid]["status"] = "running"
        try: _finish(jid, FDALabelLoader(_get_e(), _get_s()).load_from_medications_table(body.table_name))
        except Exception as e: _fail(jid, e)
    bg.add_task(run)
    return IndexJobResponse(status="queued", job_id=jid,
                            message=f"FDA labels started. Poll GET /rag/jobs/{jid}")

# ── POST /rag/index/snomed ─────────────────────────────────────────────────────
@router.post("/index/snomed", response_model=IndexJobResponse, status_code=202,
             summary="Index SNOMED CT Conditions",
             description=(
                 "Scans `conditions` DynamoDB table for SNOMED CT codes and indexes concept "
                 "names + synonyms from the UMLS Metathesaurus API.\n\n"
                 "Requires `UMLS_API_KEY` env var "
                 "(free: https://uts.nlm.nih.gov/uts/signup-login)."
             ))
def index_snomed(body: IndexSNOMEDRequest, bg: BackgroundTasks, _: dict = Depends(require_jwt)):
    jid = _new_job("snomed")
    def run():
        _jobs[jid]["status"] = "running"
        try: _finish(jid, SNOMEDLoader(_get_e(), _get_s(), body.umls_api_key).load_from_conditions_table(body.table_name))
        except Exception as e: _fail(jid, e)
    bg.add_task(run)
    return IndexJobResponse(status="queued", job_id=jid,
                            message=f"SNOMED started. Poll GET /rag/jobs/{jid}")

# ── POST /rag/index/loinc ──────────────────────────────────────────────────────
@router.post("/index/loinc", response_model=IndexJobResponse, status_code=202,
             summary="Index LOINC Observation Codes",
             description=(
                 "Indexes LOINC codes with clinical names, units, and reference ranges. "
                 "16 common codes (vitals, CBC, metabolic panel) are always included from a "
                 "built-in table — **no DynamoDB or external API required.**\n\n"
                 "Pass `loinc_csv_path` to index the full LOINC table (free download from loinc.org)."
             ))
def index_loinc(body: IndexLOINCRequest, bg: BackgroundTasks, _: dict = Depends(require_jwt)):
    jid = _new_job("loinc", 16)
    def run():
        _jobs[jid]["status"] = "running"
        try: _finish(jid, LOINCLoader(_get_e(), _get_s(), body.loinc_csv_path).load_from_observations_table(body.table_name))
        except Exception as e: _fail(jid, e)
    bg.add_task(run)
    return IndexJobResponse(status="queued", job_id=jid,
                            message=f"LOINC started. Poll GET /rag/jobs/{jid}")

# ── POST /rag/index/guidelines ─────────────────────────────────────────────────
@router.post("/index/guidelines", response_model=IndexJobResponse, status_code=202,
             summary="Index Clinical Practice Guideline (PDF or HTML)",
             description=(
                 "Downloads and indexes a clinical practice guideline. "
                 "URL ending in `.pdf` → PDF text extraction; otherwise → HTML stripping.\n\n"
                 "Implements GARMLE-G retrieval pattern (arXiv:2506.21615). "
                 "Sliding-window chunking: default 400-word chunks, 50-word overlap."
             ))
def index_guideline(body: IndexGuidelineRequest, bg: BackgroundTasks, _: dict = Depends(require_jwt)):
    jid = _new_job("guidelines")
    def run():
        _jobs[jid]["status"] = "running"
        try:
            loader = GuidelineLoader(_get_e(), _get_s())
            fn = loader.load_pdf if body.url.endswith(".pdf") else loader.load_html
            _finish(jid, fn(body.url, body.source_label, body.chunk_size, body.overlap))
        except Exception as e: _fail(jid, e)
    bg.add_task(run)
    return IndexJobResponse(status="queued", job_id=jid,
                            message=f"Guideline started. Poll GET /rag/jobs/{jid}")

# ── GET /rag/index/status ──────────────────────────────────────────────────────
@router.get("/index/status", response_model=IndexStatusResponse,
            summary="Vector Index Statistics")
def index_status():
    raw = _get_s().stats()
    e = _get_e()
    return IndexStatusResponse(
        backend=raw.get("backend", settings.rag_vector_backend),
        shards={n: ShardStatus(doc_count=v.get("doc_count",0), last_indexed=v.get("last_indexed"))
                for n, v in raw.get("shards",{}).items()},
        total_docs=raw.get("total_docs",0),
        embedder=settings.rag_embed_backend,
        dimension=e._dim or 0)

# ── GET /rag/jobs/{job_id} ─────────────────────────────────────────────────────
@router.get("/jobs/{job_id}", response_model=JobStatusResponse,
            summary="Background Indexing Job Status")
def job_status(job_id: str):
    job = _jobs.get(job_id)
    if not job: raise HTTPException(404, f"Job {job_id!r} not found")
    return JobStatusResponse(**job)

# ── DELETE /rag/index ──────────────────────────────────────────────────────────
@router.delete("/index", summary="Delete Vector Index (Admin Only)")
def delete_index(shard: Optional[str] = Query(None), payload: dict = Depends(require_jwt)):
    if payload.get("role") != "admin":
        raise HTTPException(403, "Admin role required")
    _get_s().delete_index(shard=shard)
    return {"status":"deleted","shard":shard or "all"}
