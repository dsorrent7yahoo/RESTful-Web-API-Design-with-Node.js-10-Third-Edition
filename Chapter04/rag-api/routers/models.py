"""
routers/models.py — FastAPI router for the named model registry (/rag/models/*).

PURPOSE
-------
The RAG API supports multiple named pipeline configurations called "models".
Each model specifies which LLM to use, which corpus shard to search, and
retrieval tuning parameters.  This router manages the lifecycle of those models.

THE THREE BUILT-IN MODELS
--------------------------
main      Production model.  Uses Amazon Nova Pro (on-demand Bedrock),
          searches all corpus shards (medications + LOINC + FDA labels +
          SNOMED + guidelines).  Active by default.

test      Lightweight test model.  Uses Amazon Nova Lite (cheaper, faster),
          restricted to the LOINC shard only (16 documents).
          Used for CI/CD validation and cost-efficient smoke tests.

staging   Pre-production model for evaluating new LLMs.
          Uses Claude Sonnet 4.6 via cross-region inference profile
          (us.anthropic.claude-sonnet-4-6).  Searched all shards.
          Promote to active after it passes the test suite.

MODEL LIFECYCLE
---------------
1. Register:  POST /rag/models/               (create a named config)
2. Test:      POST /rag/models/{name}/test    (run clinical questions)
3. Promote:   POST /rag/models/{name}/promote (test + activate in one call)
4. Activate:  PUT  /rag/models/{name}/activate (force-activate without testing)
5. View:      GET  /rag/models/{name}
6. Delete:    DELETE /rag/models/{name}       (admin JWT required)

PERSISTENCE
-----------
Model configs are saved to two locations on every create/update/delete:
  Local JSON file  RAG_MODEL_REGISTRY_PATH (default /tmp/rag-model-registry.json)
  DynamoDB         rag-model-registry table (survives EC2 reboots)

On startup, _load_registry() tries DynamoDB first, then the local JSON file.

HOW /promote WORKS
------------------
POST /rag/models/{name}/promote is the preferred way to roll out a new model.
It activates the model temporarily, runs 3 clinical test questions against
the live /rag/query/simple endpoint via an internal HTTP call, then either:
  - Activates the model permanently if all answers pass (length > 10 chars)
  - Restores the previous active model if any test fails (HTTP 422 returned)

This pattern ensures the new model can actually answer questions with the
current corpus before it becomes the default.

FUNCTIONS
---------
_save_registry()   Write _models to JSON file + DynamoDB.
_load_registry()   Load from DynamoDB (fallback: JSON file) at import time.
_to_status(cfg)    Convert internal config dict to ModelStatus Pydantic model.
_doc_count(shard)  Count docs in one shard of the current vector store.
"""

import json, jwt, time, uuid
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from auth import require_jwt
from config import settings
from models.schemas import ModelConfig, ModelStatus, ModelTestRequest, ModelTestResult
from rag.embedder import Embedder
from rag.vector_store import VectorStore
from rag.retriever import HybridRetriever
from rag.generator import Generator
from rag.pipeline import RAGPipeline
from rag.dynamo_store import save_model, load_all_models, delete_model

router = APIRouter()

import os as _os
_REGISTRY_PATH = _os.getenv("RAG_MODEL_REGISTRY_PATH", "/tmp/rag-model-registry.json")

_models: dict = {
    "main": {
        "name":"main","label":"Production Model","embed_backend":"clinicalbert",
        "llm_backend":"bedrock","llm_model":"amazon.nova-pro-v1:0","shard_filter":None,
        "top_k":5,"alpha":0.6,"description":"Full production RAG pipeline — all corpus shards, Nova Pro LLM",
        "is_active":True,"created_at":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),
        "last_tested":None,"test_pass":None,
    },
    "test": {
        "name":"test","label":"Test Model","embed_backend":"clinicalbert",
        "llm_backend":"bedrock","llm_model":"amazon.nova-lite-v1:0","shard_filter":"loinc",
        "top_k":3,"alpha":0.6,"description":"Lightweight test — LOINC only, Nova Lite",
        "is_active":False,"created_at":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),
        "last_tested":None,"test_pass":None,
    },
    "staging": {
        "name":"staging","label":"Staging / Claude","embed_backend":"clinicalbert",
        "llm_backend":"bedrock","llm_model":"us.anthropic.claude-sonnet-4-6","shard_filter":None,
        "top_k":5,"alpha":0.7,"description":"Claude Sonnet 4.6 inference profile — high quality",
        "is_active":False,"created_at":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),
        "last_tested":None,"test_pass":None,
    },
}
_pipeline_cache: dict = {}

def _save_registry():
    try:
        with open(_REGISTRY_PATH, "w", encoding="utf-8") as _f:
            json.dump(_models, _f, indent=2)
    except Exception as _e:
        import logging; logging.getLogger(__name__).warning("Cannot save registry to disk: %s", _e)
    for _name, _cfg in _models.items():
        try: save_model(_cfg)
        except Exception as _e:
            import logging; logging.getLogger(__name__).warning("Cannot save %r to DynamoDB: %s", _name, _e)

def _load_registry():
    try:
        from_dynamo = load_all_models()
        if from_dynamo:
            _models.update(from_dynamo)
            import logging; logging.getLogger(__name__).info("Loaded %d models from DynamoDB", len(from_dynamo))
            return
    except Exception as _e:
        import logging; logging.getLogger(__name__).warning("DynamoDB load failed: %s", _e)
    if _os.path.exists(_REGISTRY_PATH):
        try:
            with open(_REGISTRY_PATH, encoding="utf-8") as _f:
                _models.update(json.load(_f))
        except Exception as _e:
            import logging; logging.getLogger(__name__).warning("Cannot load local registry: %s", _e)

_load_registry()

def _get_or_build_pipeline(name: str) -> RAGPipeline:
    if name not in _pipeline_cache:
        cfg = _models[name]
        embedder = Embedder(cfg["embed_backend"])
        store    = VectorStore(settings.rag_vector_backend, settings.rag_opensearch_index)
        retriever = HybridRetriever(embedder, store, cfg["alpha"])
        generator = Generator(cfg["llm_backend"])
        _pipeline_cache[name] = RAGPipeline(embedder, retriever, generator)
    return _pipeline_cache[name]

def _doc_count(shard):
    try:
        store = VectorStore(settings.rag_vector_backend, settings.rag_opensearch_index)
        raw = store.stats()
        return raw.get("shards", {}).get(shard, {}).get("doc_count", 0) if shard else raw.get("total_docs", 0)
    except Exception:
        return 0

def _to_status(cfg: dict) -> ModelStatus:
    return ModelStatus(
        name=cfg["name"], label=cfg["label"], is_active=cfg.get("is_active",False),
        embed_backend=cfg["embed_backend"], llm_backend=cfg["llm_backend"],
        llm_model=cfg["llm_model"], shard_filter=cfg.get("shard_filter"),
        top_k=cfg["top_k"], alpha=cfg["alpha"], description=cfg.get("description",""),
        created_at=cfg["created_at"], last_tested=cfg.get("last_tested"),
        test_pass=cfg.get("test_pass"), doc_count=_doc_count(cfg.get("shard_filter")),
    )

@router.get("/", response_model=list[ModelStatus], include_in_schema=False, summary="List All Models")
def list_models(_: dict = Depends(require_jwt)) -> list[ModelStatus]:
    return [_to_status(cfg) for cfg in _models.values()]

@router.get("/{name}", response_model=ModelStatus, summary="Get One Model")
def get_model(name: str, _: dict = Depends(require_jwt)) -> ModelStatus:
    if name not in _models:
        raise HTTPException(404, f"Model {name!r} not found")
    return _to_status(_models[name])

@router.post("/", response_model=ModelStatus, status_code=201, summary="Register a New Model")
def create_model(body: ModelConfig, _: dict = Depends(require_jwt)) -> ModelStatus:
    cfg = body.model_dump()
    cfg.update({"is_active":False,"created_at":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),
                "last_tested":None,"test_pass":None})
    _models[body.name] = cfg
    _pipeline_cache.pop(body.name, None)
    _save_registry()
    return _to_status(cfg)

@router.put("/{name}/activate", response_model=ModelStatus, summary="Activate a Model")
def activate_model(name: str, _: dict = Depends(require_jwt)) -> ModelStatus:
    if name not in _models:
        raise HTTPException(404, f"Model {name!r} not found")
    for k in _models:
        _models[k]["is_active"] = (k == name)
    _save_registry()
    return _to_status(_models[name])

@router.post("/{name}/test", response_model=list[ModelTestResult], summary="Run Test Queries Against a Model")
def test_model(name: str, body: ModelTestRequest, _: dict = Depends(require_jwt)) -> list[ModelTestResult]:
    if name not in _models:
        raise HTTPException(404, f"Model {name!r} not found")
    cfg = _models[name]
    import os as _env
    orig = _env.environ.get("RAG_LLM_MODEL", "")
    _env.environ["RAG_LLM_MODEL"] = cfg["llm_model"]
    pipeline = _get_or_build_pipeline(name)
    pipeline.generator.backend = cfg["llm_backend"]
    results = []
    all_passed = True
    for q in body.questions:
        try:
            r = pipeline.query(q, mode=body.mode, top_k=cfg["top_k"],
                               shard_filter=cfg.get("shard_filter"))
            results.append(ModelTestResult(
                question=q, answer=r["answer"][:500],
                sources_count=len(r.get("sources",[])),
                latency_ms=r.get("latency_ms",0),
                tokens_total=r.get("tokens",{}).get("total",0), error=None))
        except Exception as e:
            all_passed = False
            results.append(ModelTestResult(question=q, answer="", sources_count=0,
                                           latency_ms=0, tokens_total=0, error=str(e)))
    _env.environ["RAG_LLM_MODEL"] = orig
    cfg["last_tested"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    cfg["test_pass"] = all_passed
    _save_registry()
    return results

@router.post("/{name}/promote", response_model=ModelStatus, summary="Promote Model — Test Then Activate")
def promote_model(name: str, payload: dict = Depends(require_jwt)) -> ModelStatus:
    """Runs 3 test queries against the live API, then activates the model if all pass."""
    if name not in _models:
        raise HTTPException(404, f"Model {name!r} not found")
    cfg = _models[name]

    # Temporarily activate this model so /rag/query/simple uses it
    orig_active = {k: v["is_active"] for k, v in _models.items()}
    for k in _models: _models[k]["is_active"] = (k == name)

    # Build a short-lived JWT for the internal HTTP calls
    import httpx
    token = jwt.encode(
        {"sub":"promote","role":"admin","scopes":[],"exp":int(time.time())+120},
        settings.jwt_secret, algorithm="HS256"
    )
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    base = f"http://127.0.0.1:{settings.port}"

    shard = cfg.get("shard_filter")
    test_qs = [
        ("What is the normal HbA1c range?",         shard or "loinc"),
        ("What is Metformin prescribed for?",        shard),
        ("Normal blood pressure reference range?",   shard or "loinc"),
    ]
    all_passed = True
    for q, sf in test_qs:
        body: dict = {"question": q, "mode": "standard", "top_k": cfg["top_k"]}
        if sf:
            body["index_filter"] = sf
        try:
            resp = httpx.post(f"{base}/rag/query/simple", json=body,
                              headers=headers, timeout=90.0)
            if resp.status_code != 200:
                all_passed = False; break
            if len((resp.json().get("answer") or "").strip()) < 10:
                all_passed = False; break
        except Exception as _e:
            import logging as _l; _l.getLogger(__name__).warning("Promote call failed: %s", _e)
            all_passed = False; break

    # Restore original active flags
    for k in _models: _models[k]["is_active"] = orig_active[k]

    cfg["last_tested"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    cfg["test_pass"] = all_passed
    if not all_passed:
        _save_registry()
        raise HTTPException(422, f"Model {name!r} failed promote tests. Use PUT /{name}/activate to force.")
    for k in _models: _models[k]["is_active"] = (k == name)
    _save_registry()
    return _to_status(_models[name])

@router.delete("/{name}", summary="Delete a Model")
def delete_model_ep(name: str, payload: dict = Depends(require_jwt)) -> dict:
    if payload.get("role") != "admin":
        raise HTTPException(403, "Admin role required")
    if name not in _models:
        raise HTTPException(404, f"Model {name!r} not found")
    _models.pop(name); _pipeline_cache.pop(name, None)
    delete_model(name)
    return {"status": "deleted", "name": name}
