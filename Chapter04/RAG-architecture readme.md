# RAG Architecture — Healthcare Medication Intelligence Layer

> **Project root:** `Chapter04/flask-dynamo-db-backend/`  
> **New FastAPI service:** `Chapter04/rag-api/`  
> **Data source:** Synthea Coherent Dataset (`coherent-11-07-2022/csv/`)  
> **Backend runtime:** Python 3.12 · FastAPI · AWS DynamoDB · boto3

---

## Executive Summary

This project represents a production-ready **Retrieval-Augmented Generation (RAG) API** built on top of the
existing healthcare backend stack. The system answers clinical questions — drug
interactions, diagnosis support, lab reference ranges, medication reviews — by
retrieving relevant passages from an indexed medical corpus and grounding the answer
in a large language model, with every claim cited back to a source document.

### What was built

| Component | Technology | Status | Purpose |
|---|---|---|---|
| **RAG API service** | FastAPI · Python 3.12 · port 4005 | ✅ Running | Exposes all RAG operations as REST endpoints with JWT auth, OpenAPI docs, and background indexing jobs |
| **Embedding model** | `pritamdeka/S-PubMedBert-MS-MARCO` (ClinicalBERT, 768-dim, local) | ✅ Loaded | Converts clinical text (drug names, LOINC codes, diagnoses) into 768-dim vectors; runs locally so PHI never leaves the AWS account |
| **Vector store** | In-memory numpy + pickle → upgrade path to OpenSearch | ✅ 516 docs | Stores and searches all embedded document vectors using cosine similarity; persists to disk between restarts |
| **Hybrid retriever** | BM25 + dense cosine similarity, Reciprocal Rank Fusion (α=0.6) | ✅ Active | Combines keyword search (exact drug names/codes) with semantic search (clinical synonyms) for higher recall than either alone |
| **LLM backends** | Amazon Bedrock Nova Pro · Nova Lite · Claude Sonnet 4.6 | ✅ All tested | Generates grounded clinical answers, DRP reports, PartiQL queries, and CPG-cited diagnoses from retrieved passages |
| **Model registry** | 3 named models (main/test/staging) persisted to DynamoDB | ✅ In DynamoDB | Stores named pipeline configurations (LLM, shard, top_k, test results) so models survive EC2 reboots and can be promoted without redeploying |
| **Corpus indexed** | 500 medications (DynamoDB) + 16 LOINC observation codes + **520 FDA drug label sections** | ✅ 1,036 docs |
| **Use-case API: Pharmacist** | `pharmacist_review.py` · port 4006 · 3 DRP endpoints | ✅ Running |
| **Use-case API: EHR Query** | `ehr_query.py` · port 4007 · NL to PartiQL | ✅ Running |
| **Use-case API: Diagnosis** | `diagnosis_support.py` · port 4008 · GARMLE-G diagnosis | ✅ Running | Provides the factual knowledge base the LLM retrieves from; expanding with FDA labels and SNOMED adds drug interaction and condition context |
| **Swagger UI** | `rag-api/rag-swagger/index.html` · live at http://localhost:4005/docs | ✅ Generated | Interactive API documentation with Try-it-out for every endpoint, grouped into RAG, RAG — ID-Free, Models, and Health tags |
| **Postman collection** | `rag-api/rag-swagger/postman-collection.json` — 7 folders, 19 requests | ✅ Generated | Pre-built API request library for testing all endpoints; folders clearly separate WITH-ID and NO-ID variants |
| **IAM policies** | `rag-api/aws-iam-policy.json` — least-privilege for Bedrock + DynamoDB | ✅ Written | Defines the minimum AWS permissions needed to run the RAG API on EC2 or ECS without over-privileged credentials |

### Four generation modes — all verified with AWS Bedrock

| Mode | What it returns | Research basis |
|---|---|---|
| `standard` | Grounded clinical answer with `[source: id]` citations | Lewis et al. 2020 (NeurIPS) |
| `copilot` | PCNE Drug-Related Problem report for pharmacist review | arXiv:2402.01741 |
| `sql` | DynamoDB PartiQL SELECT statement from natural language | arXiv:2603.05569 |
| `diagnosis` | ICD/SNOMED differential diagnosis + CPG guideline citations | arXiv:2506.21615 |

### Three dedicated use-case APIs

| API | Port | File | Purpose |
|---|---|---|---|
| **Pharmacist Review** | 4006 | `pharmacist_review.py` | DRP reviews via `POST /review/medication`, `/review/interaction`, `/review/patient/{id}` |
| **EHR Query** | 4007 | `ehr_query.py` | Natural language → PartiQL via `POST /ehr/query`; lists all DynamoDB tables |
| **Diagnosis Support** | 4008 | `diagnosis_support.py` | GARMLE-G diagnosis via `POST /diagnosis/evaluate`, `/diagnosis/lab`, `/diagnosis/patient/{id}` |

Each has its own colour-coded Swagger UI in `rag-api/rag-swagger/`:

```
rag-swagger/index-pharmacist.html   ← red  — Pharmacist Review
rag-swagger/index-ehr-query.html    ← blue — EHR Query
rag-swagger/index-diagnosis.html    ← green — Diagnosis Support
```

### Two API flavours — both documented in Swagger

| Endpoint | ID fields | Use when |
|---|---|---|
| `POST /rag/query` | Optional `patient_id`, `index_filter` | Patient-aware PACE-RAG retrieval |
| `POST /rag/query/simple` | None | Anonymous clinical question |
| `POST /rag/index/medications` | `table_name`, `patient_id`, `limit` | Custom table or patient subset |
| `POST /rag/index/simple` | None | Index default corpus from env vars |

### Three named models — tested, activated, stored in DynamoDB

| Model | LLM | Corpus | Test | Active |
|---|---|---|---|---|
| **main** | `amazon.nova-pro-v1:0` (Nova Pro) | All shards | ✅ Pass | ★ |
| **test** | `amazon.nova-lite-v1:0` (Nova Lite) | LOINC only | ✅ Pass | |
| **staging** | `us.anthropic.claude-sonnet-4-6` | All shards | ✅ Pass | |

### Key design decisions

- **Local embedding** — ClinicalBERT runs on the same machine as the API (no external call,
  PHI never leaves the AWS account). 768 dimensions balances biomedical accuracy with
  memory footprint (~30 MB for 10,000 documents).
- **Hybrid retrieval** — BM25 catches exact drug names and RxNorm codes that dense vectors
  may rank lower; dense retrieval catches semantic synonyms. RRF merges both rankings.
- **Bedrock over OpenAI** — uses existing AWS IAM credentials; no additional API key;
  model switching (Nova ↔ Claude) requires only an env-var change.
- **Memory vector store → OpenSearch** — the in-memory store works for development and
  single-node EC2. Switch to OpenSearch for multi-node or >100k documents by setting
  `RAG_VECTOR_BACKEND=opensearch` in `.env`.
- **DynamoDB model registry** — model configurations (LLM, shard, test results, active flag)
  survive EC2 reboots because they are written to the `rag-model-registry` DynamoDB table
  on every create / activate / test operation.

### Quick start

```bash
# 1. Start all services (frontends + backends + RAG API)
bash /tmp/start-all.sh

# 2. Index the corpus (first time only — ~3 min)
bash /tmp/rag-generate.sh

# 3. Open Swagger UI
start Chapter04/rag-api/rag-swagger/index.html
# or visit http://localhost:4005/docs
```

---

## Table of Contents

1. [Motivation & Research Foundation](#1-motivation--research-foundation)
2. [Python Library Reference](#2-python-library-reference)
3. [System Architecture](#3-system-architecture)
4. [Existing Infrastructure (Inventory)](#4-existing-infrastructure-inventory)
5. [RAG Layer — New Modules & Functions](#5-rag-layer--new-modules--functions)
6. [API Reference — New RAG Endpoints](#6-api-reference--new-rag-endpoints)
7. [Corpus Sources & Indexing Strategy](#7-corpus-sources--indexing-strategy)
8. [Data Flow Diagrams](#8-data-flow-diagrams)
9. [Environment Variables](#9-environment-variables)
10. [Implementation Sequence](#10-implementation-sequence)
11. [AWS IAM Permissions](#11-aws-iam-permissions)
12. [Model Management — Creating, Testing & Switching Models](#12-model-management--creating-testing--switching-models)
13. [Vector Dimensions — Rationale and Selection Guide](#13-vector-dimensions--rationale-and-selection-guide)
14. [Use-Case APIs — Pharmacist Review, EHR Query, Diagnosis Support](#14-use-case-apis--pharmacist-review-ehr-query-diagnosis-support)
6. [Corpus Sources & Indexing Strategy](#6-corpus-sources--indexing-strategy)
7. [Data Flow Diagrams](#7-data-flow-diagrams)
8. [Environment Variables](#8-environment-variables)
9. [Implementation Sequence](#9-implementation-sequence)

---

## 1. Motivation & Research Foundation

The following peer-reviewed white papers directly map to the data tables and clinical
domain of this project.

### Foundational

| Paper | arXiv | Key Idea |
|---|---|---|
| **Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks** — Lewis et al. (NeurIPS 2020) | [2005.11401](https://arxiv.org/abs/2005.11401) | Original RAG architecture: dense retriever + seq2seq generator over non-parametric memory. Blueprint for the entire pipeline. |

### Medication-Specific RAG

| Paper | arXiv | Maps to This Project |
|---|---|---|
| **PACE-RAG: Patient-Aware Contextual and Evidence-Constrained RAG for Clinical Drug Recommendation** — Huh et al. (2026) | [2603.17356](https://arxiv.org/abs/2603.17356) | Mirrors `GET /medications/patient/<id>` and `GET /medications/patients/multiple-medications`. Patient features → similar-case retrieval → Llama-3.1-8B/Qwen3 prescribing recommendation. F1=80.84% on Parkinson's cohort. |
| **RAG-LLM CDSS for Medication Safety in 12 Clinical Specialties** — Ong et al. (2024) | [2402.01741](https://arxiv.org/abs/2402.01741) | Drug reference corpus → RAG-GPT-4/Med-PaLM 2 identifies Drug-Related Problems (DRPs). Co-pilot mode is the target UX for `POST /rag/query?mode=copilot`. |

### EHR Multimodal RAG

| Paper | arXiv | Maps to This Project |
|---|---|---|
| **REALM: RAG-Driven Enhancement of Multimodal EHR Analysis via LLMs** — Zhu et al. (2024) | [2402.07016](https://arxiv.org/abs/2402.07016) | Clinical notes + time-series vitals → PrimeKG knowledge graph retrieval → adaptive fusion. `observations.csv` (LOINC vitals/labs) is the time-series input layer. |
| **EMERGE: Enhancing Multimodal EHR Predictive Modeling with RAG** — Zhu et al. (CIKM 2024) | [2406.00036](https://arxiv.org/abs/2406.00036) | Extends REALM with richer KG entity definitions. Code: [github.com/yhzhu99/EMERGE](https://github.com/yhzhu99/EMERGE). MIMIC-III/IV benchmarks. |

### Diagnosis & Clinical Guidelines RAG

| Paper | arXiv | Maps to This Project |
|---|---|---|
| **GARMLE-G: Refine Medical Diagnosis Using Generation-Augmented Retrieval and Clinical Practice Guidelines** — Li et al. (JBHI 2025) | [2506.21615](https://arxiv.org/abs/2506.21615) | EHR → LLM prediction → CPG snippet retrieval → hallucination-free output. `conditions.csv` (SNOMED codes) feeds the diagnosis query layer. |

### RAG over EHR/Claims Databases (Text-to-SQL)

| Paper | arXiv | Maps to This Project |
|---|---|---|
| **CBR-to-SQL: Retrieval-based Text-to-SQL with Case-based Reasoning in Healthcare** — Nguyen et al. (2026) | [2603.05569](https://arxiv.org/abs/2603.05569) | 2-stage retrieval: structural + entity alignment for NL→SQL. Directly applicable to `POST /rag/query?mode=sql` over DynamoDB. |
| **RAG Text-to-SQL for Epidemiological QA using EHR and Claims Data** — Ziletti & D'Ambrosi (NAACL 2024) | [2403.09226](https://arxiv.org/abs/2403.09226) | Medical coding step inside text-to-SQL pipeline. `claims_app` + `encounters.csv` is the exact dataset studied. |

### Privacy-Preserving On-Prem RAG

| Paper | arXiv | Maps to This Project |
|---|---|---|
| **PrecLLM: Privacy-Preserving Framework for Clinical Annotation Extraction using Small-Scale LLMs** — Qu et al. (2024/2026) | [2412.02868](https://arxiv.org/abs/2412.02868) | RAG preprocessing (regex + semantic) for local deployment with small LLMs. PHI in DynamoDB cannot leave the AWS account — Llama-3.1-8B local inference applies this pattern. |

---

## 2. Python Library Reference

The table below explains every library in `rag-api/requirements.txt` and its specific
role in the RAG pipeline.  Libraries are grouped by the pipeline stage they serve.

### 2.1 API Framework

| Library | Version | Purpose in this project |
|---|---|---|
| **fastapi** | ≥0.115 | Web framework for all `/rag/*` endpoints. Provides automatic OpenAPI/Swagger docs at `/docs`, async request handling, Pydantic request validation, and dependency injection (JWT auth, pipeline singleton). Chosen over Flask for its native async support and typed route parameters. |
| **uvicorn[standard]** | ≥0.30 | ASGI server that runs the FastAPI app. The `[standard]` extra adds `uvloop` (faster event loop) and `httptools` (faster HTTP parsing). Started via `uvicorn main:app --reload --port 4005`. |
| **pydantic** | ≥2.0 | Data validation library underpinning FastAPI. Every request body (`RAGQueryRequest`) and response (`RAGQueryResponse`) is a Pydantic `BaseModel` — provides automatic type coercion, field constraints (`ge=1, le=20`), and JSON serialisation. |
| **pydantic-settings** | ≥2.7 | Extension of Pydantic for reading configuration from environment variables and `.env` files. Powers `config.py` — all `RAG_*` env vars are declared as typed fields on the `Settings` class. |

### 2.2 Authentication

| Library | Version | Purpose in this project |
|---|---|---|
| **PyJWT** | ≥2.9 | Decodes and validates the same JWT Bearer tokens issued by the Flask backend's `/login` endpoint. Used in `auth.py`'s `require_jwt` FastAPI dependency. Raises `401 Unauthorized` on expired or tampered tokens. |

### 2.3 Embedding — Converting Text to Vectors

| Library | Version | Purpose in this project |
|---|---|---|
| **sentence-transformers** | ≥3.3 | Loads and runs the biomedical sentence encoder (`pritamdeka/S-PubMedBert-MS-MARCO` by default) **locally** on the machine — no external API call, no PHI leaves the environment. Implements `SentenceTransformer.encode()` used in `rag/embedder.py`. Produces 768-dimensional float vectors per text chunk. |
| **numpy** | ≥1.26 | Used in two places: (1) the in-memory vector store (`rag/vector_store.py`) stores all document embeddings as a `numpy` matrix and computes **cosine similarity** via `np.dot` + `np.linalg.norm` for ANN search; (2) batch normalisation of embedding arrays before indexing. |

### 2.4 Retrieval — Finding Relevant Documents

| Library | Version | Purpose in this project |
|---|---|---|
| **rank-bm25** | ≥0.2.2 | Pure-Python BM25 (Best Match 25) sparse keyword retrieval. In `rag/retriever.py`, a `BM25Okapi` index is maintained over all indexed document texts. BM25 scores are combined with dense vector scores via **Reciprocal Rank Fusion** to produce the hybrid retrieval result. Keyword search captures exact drug names and codes (e.g. `"Ibuprofen 200 MG"`, `"162864005"`) that dense vectors may rank lower. |

### 2.5 Generation — LLM Backends

| Library | Version | Purpose in this project |
|---|---|---|
| **openai** | ≥1.50 | Official OpenAI Python SDK. Used in `rag/generator.py` when `RAG_LLM_BACKEND=openai`. Sends the retrieved passages + user question to `gpt-4o` (configurable) via `client.chat.completions.create()`. Supports streaming and token-usage tracking. |
| **boto3** | ≥1.35 | AWS SDK — two roles in this project: (1) **DynamoDB** access in all corpus loaders (`medication_indexer.py`, etc.) to scan tables; (2) **AWS Bedrock** backend in `rag/generator.py` when `RAG_LLM_BACKEND=bedrock`, calling `amazon.nova-pro-v1:0` or `anthropic.claude-3-5-sonnet`. Credentials are inherited from `~/.aws/` or the EC2 instance profile — no secrets stored in code. |
| **httpx** | ≥0.27 | Async-capable HTTP client used for two purposes: (1) calling the **Ollama** local LLM server (`RAG_LLM_BACKEND=ollama`) in `rag/generator.py`; (2) fetching external corpus sources in `fda_label_loader.py`, `snomed_loader.py`, and `guideline_loader.py`. Preferred over `requests` for its native async support inside FastAPI coroutines. |

### 2.6 Corpus Loading — Ingesting External Knowledge Sources

| Library | Version | Purpose in this project |
|---|---|---|
| **requests** | ≥2.32 | Synchronous HTTP client used in `rag/corpus/fda_label_loader.py` for paging through the FDA OpenFDA REST API (`api.fda.gov/drug/label.json`) and in `snomed_loader.py` for the UMLS Metathesaurus API. Used instead of httpx here because both APIs are polled synchronously in background tasks. |
| **pdfminer.six** | ≥20221105 | PDF text extraction library used in `rag/corpus/guideline_loader.py` to parse clinical practice guidelines (WHO Essential Medicines List, NIH drug monographs) downloaded as PDFs. Extracts raw text page by page before chunking and embedding. No OCR — works on text-layer PDFs. |
| **python-dotenv** | ≥1.0 | Loads `.env` file variables into `os.environ` at startup. Used as a fallback before `pydantic-settings` takes over, ensuring `OPENAI_API_KEY`, `UMLS_API_KEY`, and AWS credentials are available even when running outside Docker. |

### 2.7 Library → Pipeline Stage Map

```
User query
    │
    ▼
fastapi ──────────────── routes/rag.py (endpoint validation, auth)
pydantic ─────────────── models/schemas.py (request/response types)
PyJWT ────────────────── auth.py (Bearer token verification)
    │
    ▼
sentence-transformers ── rag/embedder.py (query → 768-dim vector)
    │
    ├─► rank-bm25 ──────── rag/retriever.py (BM25 keyword scoring)
    └─► numpy ─────────── rag/vector_store.py (cosine ANN search)
                                │
                           Reciprocal Rank Fusion
                                │
                                ▼
openai / boto3 / httpx ── rag/generator.py (LLM call with context)
    │
    ▼
FastAPI response ─────── {answer, sources, tokens, latency_ms}

Background indexing:
boto3 ───────────────── DynamoDB scan (medication_indexer.py)
requests / httpx ─────── FDA API, UMLS API, WHO PDF fetch
pdfminer.six ─────────── PDF → text (guideline_loader.py)
sentence-transformers ── text chunks → vectors
numpy ────────────────── vector upsert into memory store
```

---

## 3. System Architecture


```
╔══════════════════════════════════════════════════════════════════════════╗
║  QUERY LAYER                                                             ║
║  React Frontends (5173/5174/5175/5177)  ←→  API Gateway (:8080)        ║
╚══════════════════════════╦═══════════════════════════════════════════════╝
                           │  JWT-authenticated REST
╔══════════════════════════▼═══════════════════════════════════════════════╗
║  FLASK BACKEND (:4001)   flask-dynamo-db-backend/                        ║
║                                                                          ║
║  Existing routes:   /medications  /claims  /athena  /export  /upload    ║
║  New RAG routes:    /rag/query    /rag/index/*       /rag/index/status  ║
╚══════════════════════════╦═══════════════════════════════════════════════╝
                           │
           ┌───────────────┼────────────────────┐
           │               │                    │
╔══════════▼═══╗  ╔════════▼════════╗  ╔════════▼════════════╗
║  DynamoDB    ║  ║  Vector Store   ║  ║  LLM Endpoint       ║
║  (AWS)       ║  ║  OpenSearch /   ║  ║  OpenAI GPT-4o  OR  ║
║              ║  ║  pgvector       ║  ║  Llama-3.1-8B local ║
║  medications ║  ║                 ║  ╚═════════════════════╝
║  patients    ║  ║  Index shards:  ║
║  conditions  ║  ║  • medications  ║
║  encounters  ║  ║  • conditions   ║
╚══════════════╝  ║  • observations ║
                  ║  • fda-labels   ║
╔══════════════╗  ║  • guidelines   ║
║  External    ║  ║  • snomed       ║
║  Corpora     ║→ ║  • loinc        ║
║  FDA API     ║  ╚═════════════════╝
║  SNOMED CT   ║
║  LOINC refs  ║
║  WHO CPGs    ║
╚══════════════╝
```

**Embedding model:** `emilyalsentzer/Bio_ClinicalBERT` (local, HIPAA-safe)
  or `text-embedding-3-small` (OpenAI, for non-PHI corpora only)

**Vector similarity:** cosine, 768-dim (ClinicalBERT) or 1536-dim (OpenAI)

**Hybrid retrieval:** BM25 (keyword) + dense (semantic) with Reciprocal Rank Fusion

---

## 4. Existing Infrastructure (Inventory)

### 3.1 Flask Routes — `flask-dynamo-db-backend/routes/`

#### `routes/medications.py` — Blueprint `medications`

| Method | Path | Function | Description |
|---|---|---|---|
| `GET` | `/medications` | `get_medications()` | All medications; supports query-string filters |
| `GET` | `/medications/id/<item_id>` | `get_medication_by_id(item_id)` | Single record by DynamoDB key |
| `GET` | `/medications/patient/<patient>` | `get_medications_by_patient(patient)` | All meds for one patient UUID |
| `GET` | `/medications/code/<code>` | `get_medications_by_code(code)` | Medications by RxNorm/NDC code |
| `GET` | `/medications/medication/<medication_id>` | `get_medications_by_medication_id(medication_id)` | By medication identifier |
| `GET` | `/medications/patients/multiple-medications` | `get_patients_with_multiple_medications()` | Polypharmacy query |
| `POST` | `/medications` | `create_medication()` | Insert new medication record |
| `PUT` | `/medications/<item_id>` | `update_medication(item_id)` | Update existing record |

#### `routes/claims.py` — Blueprint `claims`

| Method | Path | Function | Description |
|---|---|---|---|
| `POST` | `/claims/generate` | `generate_claims()` | Run `synthetic_fhir_claims` Lambda — generate raw CSV |
| `POST` | `/claims/clean` | `clean_claims()` | Run `claims_cleaner` Lambda — clean + register in Glue Catalog |

#### `routes/athena.py` — Blueprint `athena`

| Method | Path | Function | Description |
|---|---|---|---|
| `POST` | `/athena/query` | `run_query()` | Execute Athena SQL against Glue Catalog; poll to completion |
| `GET` | `/athena/tables` | `list_tables()` | List all tables in Glue database |
| `GET` | `/athena/schemas` | `list_schemas()` | List all Glue databases |

Internals: `_execute(sql, database)` · `_athena()` boto3 client · `_glue()` boto3 client

#### `routes/export.py` — Blueprint `export`

| Method | Path | Function | Description |
|---|---|---|---|
| `GET` | `/export/s3/buckets` | `list_s3_buckets()` | List all S3 buckets |
| `GET` | `/export/s3/<bucket>/objects` | `list_bucket_objects(bucket)` | List objects in bucket |
| `DELETE` | `/export/s3/<bucket>` | `delete_bucket(bucket)` | Delete S3 bucket |
| `POST` | `/export/dynamodb/<table>` | `export_table(table)` | Export DynamoDB table → S3 Parquet |
| `POST` | `/export/glue/register` | `register_glue_table()` | Register exported data in Glue Catalog |

#### `routes/upload.py` — Blueprint `upload`

| Method | Path | Function | Description |
|---|---|---|---|
| `POST` | `/upload` | `upload_csv()` | CSV → DynamoDB; accepts JSON body or `multipart/form-data` |

Parameters: `tableName`, `csvPath`, `csvContent`, `fileName`, `replaceExistingTable`, `keyAttributeName`, `keyAttributeType`, `batchSize`

#### `routes/source.py` — Blueprint `source`

| Method | Path | Function | Description |
|---|---|---|---|
| `GET` | `/source/tree` | `get_tree()` | Directory tree of source files |
| `GET` | `/source/file` | `get_file()` | Read a source file by relative path |

Internals: `_safe_path(rel_path)` (path-traversal guard) · `_build_tree(base_path, rel)`

#### `routes/login.py` — Blueprint `login`

| Method | Path | Function | Description |
|---|---|---|---|
| `GET` | `/health` | `health()` | Health check — returns `{"status": "ok"}` |
| `POST` | `/login` | `login()` | Issue JWT; validates against `users` DynamoDB table |
| `POST` | `/logout` | `logout()` | Client-side token invalidation |

#### `routes/auth.py` — Blueprint `auth`

| Method | Path | Function | Description |
|---|---|---|---|
| `POST` | `/auth/register` | `register()` | Create pending user |
| `POST` | `/auth/approve/<user_id>` | `approve_user(user_id)` | Admin approves pending user |
| `GET` | `/auth/users` | `list_users()` | List all users |
| `DELETE` | `/auth/users/<user_id>` | `delete_user(user_id)` | Delete user |

### 3.2 Flask Modules — `flask-dynamo-db-backend/modules/`

#### `modules/medications.py`

| Function | Signature | Description |
|---|---|---|
| `find_all_medications` | `(args: dict) → list` | Full scan with optional filter expressions |
| `find_medication_by_id` | `(item_id: str) → dict \| None` | `get_item` by primary key |
| `find_medications_by_patient` | `(patient: str) → list` | `scan` with `Attr("PATIENT").eq(patient)` |
| `find_medications_by_code` | `(code: str) → list` | `scan` with `Attr("CODE").eq(code)` |
| `find_medications_by_medication_id` | `(medication_id: str) → list` | Scan by `medication_id` attribute |
| `find_patients_with_multiple_medications` | `(args: dict) → list` | Aggregation: patients with ≥ N distinct drugs |
| `save_medication` | `(body: dict) → dict` | `put_item` with UUID auto-generation |
| `update_medication` | `(item_id: str, body: dict) → dict \| None` | `update_item` expression |
| `resolve_patient_id_from_row` | `(row: dict) → str \| None` | Normalises id/Id/PATIENT field variants |
| `first_present_field` | `(obj: dict, fields: list) → str \| None` | Field resolution helper |

#### `modules/auth.py`

| Function | Signature | Description |
|---|---|---|
| `ensure_users_table_exists` | `() → None` | Creates `users` DynamoDB table if absent |
| `ensure_pending_users_table_exists` | `() → None` | Creates `pending_users` table if absent |
| `ensure_default_user_exists` | `() → None` | Seeds admin user on first boot |
| `validate_credentials` | `(username, password) → dict \| None` | Bcrypt hash comparison |

### 3.3 Model Layer — `flask-dynamo-db-backend/model/`

#### `model/medication.py`

| Function | Signature | Description |
|---|---|---|
| `get_table` | `(target_table_name=None) → Table` | Returns boto3 DynamoDB `Table` resource |
| `ensure_table_exists` | `(target_table_name=None) → None` | Creates table with PAY_PER_REQUEST billing if absent |
| `table_exists` | `(target_table_name=None) → bool` | Describes table; catches `ResourceNotFoundException` |
| `recreate_table` | `(target_table_name=None) → None` | Drop + recreate; used by seed scripts |
| `_to_float` | `(value) → float \| None` | Safe Decimal → float coercion |

### 3.4 Tools — `flask-dynamo-db-backend/tools/`

| Module | Class/Function | Description |
|---|---|---|
| `tools/dynamo_uploader.py` | `DynamoUploader.upload(...)` | Batch CSV → DynamoDB with schema inference |
| `tools/aws_export.py` | `DynamoToS3Exporter.export_table(...)` | DynamoDB → S3 Parquet via scan + pyarrow |

---

## 5. RAG Layer — New Modules & Functions

All new files live under `flask-dynamo-db-backend/rag/`.

### 4.1 Directory Layout

```
flask-dynamo-db-backend/
├── rag/
│   ├── __init__.py
│   ├── embedder.py            # Text → vector via ClinicalBERT or OpenAI
│   ├── vector_store.py        # OpenSearch / pgvector CRUD
│   ├── retriever.py           # Hybrid BM25 + dense retrieval
│   ├── generator.py           # LLM call wrapper
│   ├── pipeline.py            # Orchestrates query end-to-end
│   └── corpus/
│       ├── __init__.py
│       ├── medication_indexer.py   # DynamoDB medications → index
│       ├── fda_label_loader.py     # api.fda.gov/drug/label → index
│       ├── snomed_loader.py        # SNOMED CT descriptions → index
│       ├── loinc_loader.py         # LOINC reference ranges → index
│       └── guideline_loader.py     # WHO/NIH PDF guidelines → index
├── routes/
│   └── rag.py                 # /rag/* Flask blueprint
```

### 4.2 `rag/embedder.py`

```python
class Embedder:
    """Converts text to dense vectors.

    Backend selected via RAG_EMBED_BACKEND env var:
      'clinicalbert'  — emilyalsentzer/Bio_ClinicalBERT (local, HIPAA-safe)
      'openai'        — text-embedding-3-small via OpenAI API
      'bedrock'       — amazon.titan-embed-text-v2 via AWS Bedrock
    """

    def __init__(self, backend: str = "clinicalbert")
    def embed(self, text: str) -> list[float]
        """Return embedding vector for a single string."""
    def embed_batch(self, texts: list[str], batch_size: int = 64) -> list[list[float]]
        """Return embeddings for a list of strings; batches automatically."""
    def dimension(self) -> int
        """Return embedding dimension (768 for ClinicalBERT, 1536 for OpenAI)."""
```

### 4.3 `rag/vector_store.py`

```python
class VectorStore:
    """Abstraction over OpenSearch (AWS-native) or pgvector.

    Backend selected via RAG_VECTOR_BACKEND env var:
      'opensearch'  — AWS OpenSearch Serverless or self-managed
      'pgvector'    — PostgreSQL + pgvector extension
      'memory'      — in-process numpy (dev/test only)
    """

    def __init__(self, backend: str = "opensearch", index_name: str = "healthcare-rag")
    def create_index(self, dimension: int, shards: int = 1) -> None
        """Create vector index with cosine similarity metric."""
    def upsert(self, doc_id: str, vector: list[float], metadata: dict) -> None
        """Insert or replace a single document."""
    def upsert_batch(self, documents: list[dict]) -> int
        """Bulk ingest; returns count of documents indexed."""
    def search(self, query_vector: list[float], top_k: int = 10,
               filters: dict | None = None) -> list[dict]
        """ANN search; returns list of {id, score, metadata}."""
    def bm25_search(self, query_text: str, top_k: int = 10,
                    filters: dict | None = None) -> list[dict]
        """Keyword (BM25) search over metadata text fields."""
    def delete_index(self) -> None
    def stats(self) -> dict
        """Returns {index_name, doc_count, dimension, backend}."""
```

### 4.4 `rag/retriever.py`

```python
class HybridRetriever:
    """Reciprocal Rank Fusion of BM25 + dense retrieval.

    Papers:
      PACE-RAG (2603.17356) — patient feature extraction before retrieval
      CBR-to-SQL (2603.05569) — 2-stage structural + entity retrieval
    """

    def __init__(self, embedder: Embedder, vector_store: VectorStore,
                 alpha: float = 0.6)
        """alpha controls dense vs keyword weight (0=BM25 only, 1=dense only)."""

    def retrieve(self, query: str, top_k: int = 5,
                 index_filter: str | None = None,
                 patient_context: dict | None = None) -> list[dict]
        """
        Main retrieval entry point.

        Args:
            query           Natural-language question
            top_k           Number of passages to return
            index_filter    Restrict search to a specific shard
                            ('medications'|'conditions'|'fda-labels'|
                             'guidelines'|'snomed'|'loinc')
            patient_context Optional dict with {patient_id, active_meds,
                            conditions, observations} for PACE-RAG-style
                            patient-aware retrieval.
        Returns:
            list of {id, score, text, source, metadata}
        """

    def _reciprocal_rank_fusion(self, dense_hits: list, bm25_hits: list,
                                 k: int = 60) -> list[dict]
        """RRF formula: score = Σ 1/(k + rank_i)."""

    def extract_patient_features(self, patient_context: dict) -> str
        """
        Converts patient dict to a text feature summary for query augmentation.
        Implements PACE-RAG Section 3.1: patient-specific clinical feature extraction.
        """
```

### 4.5 `rag/generator.py`

```python
class Generator:
    """Wraps LLM call for RAG response generation.

    Backend selected via RAG_LLM_BACKEND env var:
      'openai'   — GPT-4o / GPT-4-turbo
      'bedrock'  — amazon.nova-pro-v1 or anthropic.claude-3-5-sonnet
      'ollama'   — Llama-3.1-8B local (privacy-preserving, PrecLLM pattern)
    """

    SYSTEM_PROMPT = """You are a clinical decision support assistant.
    Answer only from the provided context passages.
    If the context does not contain sufficient information, say so explicitly.
    Never fabricate drug names, dosages, or clinical guidelines.
    Cite the source of each claim using [source: <id>] notation."""

    def __init__(self, backend: str = "openai", model: str | None = None)
    def generate(self, query: str, passages: list[dict],
                 mode: str = "standard") -> dict
        """
        Args:
            query     Original user question
            passages  Retrieved context from HybridRetriever
            mode      'standard'  — direct answer
                      'copilot'   — structured clinical summary for pharmacist
                                    (RAG-CDSS co-pilot pattern, 2402.01741)
                      'sql'       — natural language → DynamoDB query
                                    (CBR-to-SQL pattern, 2603.05569)
                      'diagnosis' — EHR + CPG-grounded diagnosis
                                    (GARMLE-G pattern, 2506.21615)
        Returns:
            {answer, sources, confidence, tokens_used, mode}
        """
    def _build_context_block(self, passages: list[dict]) -> str
        """Format retrieved passages into the prompt context window."""
    def _sql_mode_prompt(self, query: str, schema: str) -> str
        """Generate DynamoDB PartiQL from natural language."""
```

### 4.6 `rag/pipeline.py`

```python
class RAGPipeline:
    """
    End-to-end orchestration.

    Implements the REALM/EMERGE adaptive fusion approach (2402.07016, 2406.00036):
      1. Optionally load patient context from DynamoDB
      2. Retrieve relevant passages (hybrid)
      3. Generate grounded answer via LLM
      4. Post-process / validate output
    """

    def __init__(self, embedder: Embedder, retriever: HybridRetriever,
                 generator: Generator)

    def query(self, question: str, patient_id: str | None = None,
              mode: str = "standard", top_k: int = 5,
              index_filter: str | None = None) -> dict
        """
        Full RAG query.

        Returns:
            {
              "answer":     str,
              "sources":    list[{id, text, source, score}],
              "mode":       str,
              "patient_id": str | None,
              "tokens":     {prompt, completion, total},
              "latency_ms": int
            }
        """

    def _load_patient_context(self, patient_id: str) -> dict
        """
        Fetches medications, conditions, observations for patient_id
        from DynamoDB to build PACE-RAG patient context vector.
        """

    def _validate_answer(self, answer: str, passages: list[dict]) -> dict
        """
        Hallucination guard: checks answer tokens against retrieved passages.
        Flags any drug names / dosages not present in the source corpus.
        """
```

### 4.7 `rag/corpus/medication_indexer.py`

```python
class MedicationIndexer:
    """
    Reads the medications DynamoDB table and indexes each record
    into the vector store with structured metadata.

    Document text format (per record):
        "Patient {PATIENT} was prescribed {DESCRIPTION} (code: {CODE})
         from {START} to {STOP}. Reason: {REASONDESCRIPTION}.
         Payer: {PAYER}. Cost: {TOTALCOST}."
    """

    def __init__(self, embedder: Embedder, vector_store: VectorStore,
                 table_name: str = "medications")

    def index_all(self, batch_size: int = 100) -> int
        """Full table scan → embed → upsert. Returns doc count."""

    def index_by_patient(self, patient_id: str) -> int
        """Index only records for one patient (incremental update)."""

    def _record_to_text(self, record: dict) -> str
        """Serialise one DynamoDB item to indexable text."""

    def _record_to_metadata(self, record: dict) -> dict
        """Extract filterable fields: patient, code, start, stop, payer."""
```

### 4.8 `rag/corpus/fda_label_loader.py`

```python
class FDALabelLoader:
    """
    Fetches drug labels from api.fda.gov/drug/label.json and indexes them.

    Free, public REST API — no API key required.
    Rate limit: 1000 requests/day without key, 120 000/day with key.

    Indexes sections:
        indications_and_usage · warnings · drug_interactions ·
        dosage_and_administration · contraindications · adverse_reactions
    """

    FDA_BASE = "https://api.fda.gov/drug/label.json"

    def __init__(self, embedder: Embedder, vector_store: VectorStore)

    def load_by_rxcui(self, rxcui: str) -> int
        """Fetch label for one RxNorm CUI and index all sections."""

    def load_from_medications_table(self, table_name: str = "medications") -> int
        """
        Extract all unique CODE values from DynamoDB medications table,
        map each to RxNorm CUI via openfda.rxcui field, fetch and index labels.
        Returns total sections indexed.
        """

    def _chunk_section(self, section_text: str, max_tokens: int = 400) -> list[str]
        """Split long label sections into overlapping chunks."""

    def _fetch_label(self, drug_name: str) -> dict | None
        """GET api.fda.gov/drug/label.json?search=openfda.brand_name:{name}"""
```

### 4.9 `rag/corpus/snomed_loader.py`

```python
class SNOMEDLoader:
    """
    Indexes SNOMED CT concept descriptions for conditions in the DynamoDB
    conditions table.  Uses the NLM UMLS/SNOMED REST API or a local
    SNOMED RF2 release file.

    Free UMLS API key required: https://uts.nlm.nih.gov/uts/signup-login
    """

    UMLS_BASE = "https://uts-ws.nlm.nih.gov/rest"

    def __init__(self, embedder: Embedder, vector_store: VectorStore,
                 umls_api_key: str | None = None)

    def load_from_conditions_table(self, table_name: str = "conditions") -> int
        """
        Scans conditions DynamoDB table for unique SNOMED codes,
        fetches concept name + definition from UMLS, indexes them.
        Returns concept count.
        """

    def _fetch_concept(self, snomed_code: str) -> dict | None
        """Retrieve {name, definition, synonyms} from UMLS Metathesaurus."""

    def _concept_to_text(self, concept: dict, code: str) -> str
        """'SNOMED {code}: {name}. {definition}. Synonyms: {synonyms}.'"""
```

### 4.10 `rag/corpus/loinc_loader.py`

```python
class LOINCLoader:
    """
    Indexes LOINC observation codes with reference ranges and clinical meaning.
    Source: Regenstrief LOINC table (loinc.org — free registration).

    Used to ground answers about patient observations/lab results.
    """

    def __init__(self, embedder: Embedder, vector_store: VectorStore,
                 loinc_csv_path: str | None = None)

    def load_from_observations_table(self, table_name: str = "observations") -> int
        """
        Scans observations DynamoDB/CSV for unique LOINC codes,
        fetches component name + reference range, indexes them.
        """

    def load_from_csv(self, csv_path: str) -> int
        """Load full LOINC table from local CSV download."""

    def _code_to_text(self, row: dict) -> str
        """'LOINC {CODE}: {LONG_COMMON_NAME}. Unit: {EXAMPLE_UNITS}.
           Reference range: {REFERENCE_RANGE}. Category: {CLASS}.'"""
```

### 4.11 `rag/corpus/guideline_loader.py`

```python
class GuidelineLoader:
    """
    Fetches and indexes clinical practice guidelines (CPGs) from public sources.
    Implements the GARMLE-G retrieval pattern (arXiv:2506.21615).

    Default sources (free, open access):
        WHO Essential Medicines List — https://www.who.int/publications/i/item/WHO-MHP-HPS-EML-2023.01
        NIH MedlinePlus drug info    — https://medlineplus.gov/druginformation.html
        OpenPrescribing formulary    — https://openprescribing.net/api/
    """

    def __init__(self, embedder: Embedder, vector_store: VectorStore)

    def load_pdf(self, url: str, source_label: str,
                 chunk_size: int = 400, overlap: int = 50) -> int
        """Download PDF, extract text with pdfminer, chunk, embed, index."""

    def load_who_essential_medicines(self) -> int
        """Load WHO EML into guidelines index shard."""

    def load_nih_drug_info(self, drug_names: list[str]) -> int
        """
        For each drug name, fetch MedlinePlus drug info page and index
        the description, uses, side-effects, and precautions sections.
        """

    def _split_text(self, text: str, chunk_size: int,
                    overlap: int) -> list[str]
        """Sliding-window chunker preserving sentence boundaries."""
```

---

## 6. API Reference — New RAG Endpoints

All endpoints require `Authorization: Bearer <jwt>` header.  
Blueprint registration: `app.register_blueprint(rag_bp)` in `app.py`.

### `routes/rag.py` — Blueprint `rag`

---

#### `POST /rag/query`

Natural-language clinical question answered from the indexed corpus.

**Request body (JSON)**

```json
{
  "question":     "What are the drug interactions for Ibuprofen in a patient with hypertension?",
  "patient_id":   "8b0484cd-3dbd-8b8d-1b72-a32f74a5a846",
  "mode":         "copilot",
  "top_k":        5,
  "index_filter": "medications"
}
```

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `question` | string | ✓ | — | Natural-language query |
| `patient_id` | string | — | null | Load patient EHR context for PACE-RAG |
| `mode` | string | — | `standard` | `standard` · `copilot` · `sql` · `diagnosis` |
| `top_k` | int | — | 5 | Number of retrieved passages |
| `index_filter` | string | — | null | Restrict to one index shard |

**Response 200**

```json
{
  "answer": "Ibuprofen (RxNorm 5640) is contraindicated in patients with hypertension...",
  "sources": [
    {
      "id": "fda-label-5640-drug_interactions-0",
      "text": "NSAIDs may diminish the antihypertensive effect...",
      "source": "FDA Drug Label — Ibuprofen",
      "score": 0.912
    }
  ],
  "mode": "copilot",
  "patient_id": "8b0484cd-3dbd-8b8d-1b72-a32f74a5a846",
  "tokens": { "prompt": 1823, "completion": 312, "total": 2135 },
  "latency_ms": 1240
}
```

---

#### `POST /rag/index/medications`

Scan the `medications` DynamoDB table, embed every record, and upsert into the
`medications` vector index shard.

**Request body (JSON)**

```json
{
  "table_name":   "medications",
  "batch_size":   100,
  "patient_id":   null
}
```

**Response 202**

```json
{ "status": "indexing", "documents_queued": 4721 }
```

---

#### `POST /rag/index/fda-labels`

Fetch FDA drug labels for all unique RxNorm codes in the medications table
and index them.

**Response 202**

```json
{ "status": "indexing", "unique_codes": 87, "sections_queued": 522 }
```

---

#### `POST /rag/index/snomed`

Fetch SNOMED CT concept definitions for all condition codes in the
`conditions` table.

**Request body (JSON)**

```json
{ "table_name": "conditions", "umls_api_key": "optional-override" }
```

**Response 202**

```json
{ "status": "indexing", "unique_codes": 34 }
```

---

#### `POST /rag/index/loinc`

Index LOINC observation codes found in the `observations` table.

**Response 202**

```json
{ "status": "indexing", "unique_codes": 18 }
```

---

#### `POST /rag/index/guidelines`

Load clinical practice guidelines from a URL (PDF or HTML).

**Request body (JSON)**

```json
{
  "url":          "https://www.who.int/publications/i/item/WHO-MHP-HPS-EML-2023.01",
  "source_label": "WHO Essential Medicines List 2023",
  "chunk_size":   400,
  "overlap":      50
}
```

**Response 202**

```json
{ "status": "indexing", "chunks_queued": 1847, "source_label": "WHO Essential Medicines List 2023" }
```

---

#### `GET /rag/index/status`

Return counts and health of all index shards.

**Response 200**

```json
{
  "backend":  "opensearch",
  "shards": {
    "medications":  { "doc_count": 4721,  "last_indexed": "2026-07-06T14:22:11Z" },
    "fda-labels":   { "doc_count": 522,   "last_indexed": "2026-07-06T14:25:04Z" },
    "snomed":       { "doc_count": 34,    "last_indexed": "2026-07-06T14:26:40Z" },
    "loinc":        { "doc_count": 18,    "last_indexed": "2026-07-06T14:27:00Z" },
    "guidelines":   { "doc_count": 1847,  "last_indexed": "2026-07-06T14:31:18Z" }
  },
  "total_docs": 7142,
  "embedder":  "Bio_ClinicalBERT",
  "dimension": 768
}
```

---

#### `DELETE /rag/index`

Drop and rebuild the entire vector index. **Destructive — requires admin JWT.**

**Query params:** `?shard=medications` (optional — delete only one shard)

**Response 200**

```json
{ "status": "deleted", "shard": "all" }
```

---

## 7. Corpus Sources & Indexing Strategy

| Index Shard | Source | Field Mapped | DynamoDB Table | API / File |
|---|---|---|---|---|
| `medications` | Coherent Synthea CSV / DynamoDB | `DESCRIPTION`, `CODE`, `REASONDESCRIPTION` | `medications` | Internal scan |
| `fda-labels` | FDA OpenFDA REST API | `CODE` → RxNorm CUI | `medications` | `api.fda.gov/drug/label.json` |
| `snomed` | UMLS Metathesaurus | `CODE` (SNOMED CT) | `conditions` | `uts-ws.nlm.nih.gov/rest` |
| `loinc` | Regenstrief LOINC table | `CODE` (LOINC) | `observations` | `loinc.org` CSV download |
| `guidelines` | WHO, NIH, OpenPrescribing | n/a | n/a | PDF/HTML download |

**Chunk overlap:** 50 tokens  
**Max chunk size:** 400 tokens  
**Embedding batch size:** 64 texts per inference call

---

## 8. Data Flow Diagrams

### 7.1 Indexing Pipeline (one-time / scheduled)

```
DynamoDB scan          External API
medications table  →   FDA labels      →  Text serialisation
conditions table   →   SNOMED CT           & chunking
observations table →   LOINC refs              │
                   →   WHO guidelines          ▼
                                        ClinicalBERT embed()
                                               │
                                               ▼
                                        VectorStore.upsert_batch()
                                        (OpenSearch / pgvector)
```

### 7.2 Query Pipeline (`POST /rag/query`)

```
HTTP POST /rag/query
    │
    ├─ patient_id provided?
    │      YES → DynamoDB fetch(medications + conditions + observations)
    │              → RAGPipeline._load_patient_context()
    │              → HybridRetriever.extract_patient_features()   [PACE-RAG]
    │
    ├─ HybridRetriever.retrieve(query, patient_context, top_k)
    │      ├─ Embedder.embed(query + patient_features)
    │      ├─ VectorStore.search(query_vector, top_k * 2)         [dense]
    │      ├─ VectorStore.bm25_search(query_text, top_k * 2)      [keyword]
    │      └─ _reciprocal_rank_fusion(dense, bm25)                [RRF]
    │
    ├─ Generator.generate(query, passages, mode)
    │      ├─ mode=standard  → direct clinical answer
    │      ├─ mode=copilot   → structured pharmacist summary      [2402.01741]
    │      ├─ mode=sql       → PartiQL for DynamoDB               [2603.05569]
    │      └─ mode=diagnosis → CPG-grounded diagnosis             [2506.21615]
    │
    └─ RAGPipeline._validate_answer()   hallucination guard
           └─ return {answer, sources, tokens, latency_ms}
```

---

## 9. Environment Variables

| Variable | Default | Description |
|---|---|---|
| `RAG_EMBED_BACKEND` | `clinicalbert` | `clinicalbert` · `openai` · `bedrock` |
| `RAG_VECTOR_BACKEND` | `opensearch` | `opensearch` · `pgvector` · `memory` |
| `RAG_LLM_BACKEND` | `openai` | `openai` · `bedrock` · `ollama` |
| `RAG_LLM_MODEL` | `gpt-4o` | LLM model name override |
| `RAG_OPENSEARCH_URL` | — | OpenSearch endpoint URL |
| `RAG_OPENSEARCH_INDEX` | `healthcare-rag` | Vector index name |
| `RAG_PG_DSN` | — | PostgreSQL DSN if using pgvector |
| `RAG_OLLAMA_URL` | `http://localhost:11434` | Ollama base URL for local inference |
| `OPENAI_API_KEY` | — | OpenAI API key (openai backends only) |
| `UMLS_API_KEY` | — | NLM UMLS API key for SNOMED/LOINC |
| `RAG_TOP_K` | `5` | Default retrieval count |
| `RAG_ALPHA` | `0.6` | Dense weight in hybrid retrieval (0–1) |
| `RAG_CHUNK_SIZE` | `400` | Max tokens per indexed chunk |
| `RAG_CHUNK_OVERLAP` | `50` | Sliding window overlap tokens |

---

## 10. Implementation Sequence

| Step | Module | Paper Reference | Test Signal |
|---|---|---|---|
| 1 | `rag/embedder.py` — ClinicalBERT local | Lewis 2020 | `embedder.embed("Ibuprofen 200mg")` returns 768-dim vector |
| 2 | `rag/vector_store.py` — memory backend | — | `upsert` + `search` round-trips locally |
| 3 | `rag/corpus/medication_indexer.py` | REALM 2402.07016 | All 4721 Coherent medications indexed |
| 4 | `rag/retriever.py` — dense only | PACE-RAG 2603.17356 | Top-5 for "ibuprofen patient 8b04..." |
| 5 | `rag/generator.py` — standard mode | Lewis 2020 | Grounded answer cites source IDs |
| 6 | `routes/rag.py` `POST /rag/query` | — | HTTP 200 with answer + sources |
| 7 | `rag/retriever.py` — add BM25 + RRF | CBR-to-SQL 2603.05569 | MRR improves over dense-only |
| 8 | `rag/corpus/fda_label_loader.py` | RAG-CDSS 2402.01741 | Drug interaction passages retrieved |
| 9 | `rag/generator.py` — copilot mode | RAG-CDSS 2402.01741 | Structured DRP summary returned |
| 10 | `rag/corpus/snomed_loader.py` | GARMLE-G 2506.21615 | Condition definitions indexed |
| 11 | `rag/generator.py` — diagnosis mode | GARMLE-G 2506.21615 | CPG-grounded diagnosis output |
| 12 | `rag/generator.py` — sql mode | CBR-to-SQL 2603.05569 | Valid PartiQL generated |
| 13 | Switch vector backend → OpenSearch | PrecLLM 2412.02868 | Production-scale ANN search |
| 14 | `rag/corpus/loinc_loader.py` | EMERGE 2406.00036 | Lab result context retrieved |
| 15 | `rag/corpus/guideline_loader.py` | GARMLE-G 2506.21615 | WHO EML guidelines indexed |


---

## 11. AWS IAM Permissions

All files live in `Chapter04/rag-api/`.  
Attach the policy in **11.1** to the IAM user, EC2 instance role, or ECS task role
that runs the RAG API.  For EC2 use trust policy **11.2**; for ECS Fargate use **11.3**.

---

### 11.1 Minimum IAM Policy — `aws-iam-policy.json`

Grants only the actions the RAG API actually needs.  
Replace `005905648819` with your AWS account ID before deploying.

**Permissions granted:**

| Statement | Actions | Why |
|---|---|---|
| `BedrockInvokeModels` | `bedrock:InvokeModel`, `InvokeModelWithResponseStream` | LLM generation via Nova Pro or Claude |
| `BedrockListModels` | `ListFoundationModels`, `ListInferenceProfiles`, `GetFoundationModel` | Model/profile discovery at startup |
| `DynamoDBMedicationsRead` | `Scan`, `GetItem`, `Query`, `DescribeTable` | Corpus indexing + patient context loading |
| `S3GuidelineCache` | `GetObject`, `PutObject`, `ListBucket` | Clinical guideline download cache |

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "BedrockInvokeModels",
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream"
      ],
      "Resource": [
        "arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-pro-v1:0",
        "arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-lite-v1:0",
        "arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-micro-v1:0",
        "arn:aws:bedrock:us-east-1::foundation-model/amazon.titan-embed-text-v2:0",
        "arn:aws:bedrock:us-east-1:005905648819:inference-profile/us.amazon.nova-pro-v1:0",
        "arn:aws:bedrock:us-east-1:005905648819:inference-profile/us.anthropic.claude-sonnet-4-6",
        "arn:aws:bedrock:us-east-1:005905648819:inference-profile/us.anthropic.claude-sonnet-4-20250514-v1:0",
        "arn:aws:bedrock:us-east-1:005905648819:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0",
        "arn:aws:bedrock:*:005905648819:inference-profile/*"
      ]
    },
    {
      "Sid": "BedrockListModels",
      "Effect": "Allow",
      "Action": [
        "bedrock:ListFoundationModels",
        "bedrock:ListInferenceProfiles",
        "bedrock:GetFoundationModel"
      ],
      "Resource": "*"
    },
    {
      "Sid": "DynamoDBMedicationsRead",
      "Effect": "Allow",
      "Action": [
        "dynamodb:Scan",
        "dynamodb:GetItem",
        "dynamodb:Query",
        "dynamodb:DescribeTable"
      ],
      "Resource": [
        "arn:aws:dynamodb:us-east-1:005905648819:table/medications",
        "arn:aws:dynamodb:us-east-1:005905648819:table/conditions",
        "arn:aws:dynamodb:us-east-1:005905648819:table/observations",
        "arn:aws:dynamodb:us-east-1:005905648819:table/patients",
        "arn:aws:dynamodb:us-east-1:005905648819:table/encounters",
        "arn:aws:dynamodb:us-east-1:005905648819:table/medications/index/*",
        "arn:aws:dynamodb:us-east-1:005905648819:table/conditions/index/*",
        "arn:aws:dynamodb:us-east-1:005905648819:table/observations/index/*"
      ]
    },
    {
      "Sid": "S3GuidelineCache",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::dgs-glue-staging",
        "arn:aws:s3:::dgs-glue-staging/rag-cache/*"
      ]
    }
  ]
}
```

---

### 11.2 EC2 Instance Role — Trust Policy — `aws-iam-trust-ec2.json`

Attach this as the **Trust Relationship** when creating an IAM role for an EC2 instance.
Then attach the policy from 11.1 to the same role.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "ec2.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

**CLI to create and attach:**
```bash
# Create the role
aws iam create-role \
  --role-name healthcare-rag-ec2-role \
  --assume-role-policy-document file://rag-api/aws-iam-trust-ec2.json

# Attach the permissions policy
aws iam put-role-policy \
  --role-name healthcare-rag-ec2-role \
  --policy-name rag-api-permissions \
  --policy-document file://rag-api/aws-iam-policy.json

# Create instance profile and attach role
aws iam create-instance-profile --instance-profile-name healthcare-rag-ec2-profile
aws iam add-role-to-instance-profile \
  --instance-profile-name healthcare-rag-ec2-profile \
  --role-name healthcare-rag-ec2-role
```

---

### 11.3 ECS Fargate Task Role — Trust Policy — `aws-iam-trust-ecs.json`

Used when deploying the `rag-api` Docker container on ECS Fargate.
Set this as the **Task Role** (not the Task Execution Role) in your task definition.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "ecs-tasks.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

**CLI to create and attach:**
```bash
# Create the task role
aws iam create-role \
  --role-name healthcare-rag-ecs-task-role \
  --assume-role-policy-document file://rag-api/aws-iam-trust-ecs.json

# Attach the permissions policy
aws iam put-role-policy \
  --role-name healthcare-rag-ecs-task-role \
  --policy-name rag-api-permissions \
  --policy-document file://rag-api/aws-iam-policy.json
```

---

### 11.4 Bedrock Model ID Quick Reference — `aws-bedrock-models-ref.json`

> **Critical:** Claude models require a **cross-region inference profile prefix** (`us.` / `global.`)
> for on-demand invocation. Passing the bare model ID returns `ValidationException`.
> Nova and Titan models use their direct model ID.

```json
{
  "nova_pro_direct": "amazon.nova-pro-v1:0",
  "nova_pro_profile": "us.amazon.nova-pro-v1:0",
  "nova_lite_direct": "amazon.nova-lite-v1:0",
  "nova_micro_direct": "amazon.nova-micro-v1:0",
  "claude_sonnet_46": "us.anthropic.claude-sonnet-4-6",
  "claude_sonnet_4_0": "us.anthropic.claude-sonnet-4-20250514-v1:0",
  "claude_haiku_45": "us.anthropic.claude-haiku-4-5-20251001-v1:0",
  "titan_embed_v2": "amazon.titan-embed-text-v2:0",
  "note": "Nova models: use direct model ID (on-demand supported). Claude models: MUST use inference profile prefix (us./ global.) for on-demand. Titan embed: use direct model ID for Bedrock embedding backend."
}
```

**In `RAG_LLM_MODEL` env var (set in `.env` or `docker-compose.ec2.yml`):**

| Model | Correct `RAG_LLM_MODEL` value | Region locked? |
|---|---|---|
| Amazon Nova Pro | `amazon.nova-pro-v1:0` | No — on-demand |
| Amazon Nova Lite | `amazon.nova-lite-v1:0` | No — on-demand |
| Amazon Nova Micro | `amazon.nova-micro-v1:0` | No — on-demand |
| Claude Sonnet 4.6 | `us.anthropic.claude-sonnet-4-6` | Yes — `us-east-1` / `us-west-2` |
| Claude Haiku 4.5 | `us.anthropic.claude-haiku-4-5-20251001-v1:0` | Yes — `us-east-1` / `us-west-2` |
| Claude Sonnet 4 | `us.anthropic.claude-sonnet-4-20250514-v1:0` | Yes — `us-east-1` / `us-west-2` |
| Titan Embed v2 (embed only) | `amazon.titan-embed-text-v2:0` | No — on-demand |

The `_resolve_bedrock_model()` helper in `rag/generator.py` automatically
adds the `us.` prefix when a bare `anthropic.*` model ID is passed, so both forms work:

```python
# Both resolve correctly at runtime:
RAG_LLM_MODEL=anthropic.claude-sonnet-4-6        # auto → us.anthropic.claude-sonnet-4-6
RAG_LLM_MODEL=us.anthropic.claude-sonnet-4-6     # used as-is
```

---

### 11.5 Permission Verification Script

Run this to confirm the executing identity has all required permissions before
starting the RAG API:

```bash
cd rag-api
python - << 'EOF'
import boto3, json
from rag.generator import _resolve_bedrock_model

sts = boto3.client("sts")
identity = sts.get_caller_identity()
print(f"Identity : {identity['Arn']}")
print(f"Account  : {identity['Account']}")
print()

checks = [
    ("dynamodb:Scan(medications)",    lambda: boto3.client("dynamodb").scan(TableName="medications", Limit=1, Select="COUNT")),
    ("bedrock:ListFoundationModels",  lambda: boto3.client("bedrock").list_foundation_models(byOutputModality="TEXT")),
    ("bedrock:InvokeModel(nova-pro)", lambda: boto3.client("bedrock-runtime").invoke_model(
        modelId="amazon.nova-pro-v1:0",
        body=json.dumps({"messages":[{"role":"user","content":[{"text":"ping"}]}],"inferenceConfig":{"maxTokens":5}}),
        contentType="application/json", accept="application/json")),
]

for name, fn in checks:
    try: fn(); print(f"  PASS  {name}")
    except Exception as e: print(f"  FAIL  {name}  — {e}")
EOF
```


---

## 12. Model Management — Creating, Testing & Switching Models

The RAG API maintains a **named model registry**: each model is a complete RAG
pipeline configuration (embedder + index shard + LLM).  Three models are
pre-registered at startup.

### 12.1 Pre-Registered Models

| Name | LLM | Model ID | Shard | Purpose |
|---|---|---|---|---|
| **main** *(active)* | Bedrock | `amazon.nova-pro-v1:0` | all | Production — full corpus |
| **test** | Bedrock | `amazon.nova-lite-v1:0` | `loinc` | Fast/cheap CI testing |
| **staging** | Bedrock | `us.anthropic.claude-sonnet-4-6` | all | Pre-prod Claude quality check |

---

### 12.2 API Calls — Model Lifecycle

#### List all models
```
GET  /rag/models/
Authorization: Bearer <jwt>
```
Returns all three models with `is_active`, `doc_count`, `last_tested`, `test_pass`.

#### View one model
```
GET  /rag/models/{name}
```
Example: `GET /rag/models/test`

#### Register a new model
```
POST /rag/models/
Content-Type: application/json
Authorization: Bearer <jwt>

{
  "name":         "my-claude-model",
  "label":        "Claude Haiku — medications only",
  "embed_backend": "clinicalbert",
  "llm_backend":  "bedrock",
  "llm_model":    "us.anthropic.claude-haiku-4-5-20251001-v1:0",
  "shard_filter": "medications",
  "top_k":        5,
  "alpha":        0.6,
  "description":  "Haiku for fast medication queries"
}
```

#### Activate a model (set as default for `/rag/query`)
```
PUT  /rag/models/{name}/activate
Authorization: Bearer <jwt>
```
Example: `PUT /rag/models/staging/activate`

#### Run test queries against a model
```
POST /rag/models/{name}/test
Content-Type: application/json
Authorization: Bearer <jwt>

{
  "questions": [
    "What is the normal HbA1c range?",
    "What is Metformin prescribed for?",
    "Find patients prescribed Warfarin after 2015"
  ],
  "mode": "standard"
}
```
Returns one `ModelTestResult` per question with `answer`, `sources_count`,
`latency_ms`, `tokens_total`, `error`.  Updates `last_tested` and `test_pass` on the model.

#### Delete a model (admin JWT required)
```
DELETE /rag/models/{name}
Authorization: Bearer <jwt>   # role=admin required
```

---

### 12.3 Steps to Generate a New Main Model

```bash
# Step 1 — Register the new model config
curl -s -X POST http://localhost:4005/rag/models/ \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "name":         "main-v2",
    "label":        "Production v2 — Nova Pro + full corpus",
    "embed_backend": "clinicalbert",
    "llm_backend":  "bedrock",
    "llm_model":    "amazon.nova-pro-v1:0",
    "top_k":        5,
    "alpha":        0.6,
    "description":  "New production model after full re-index"
  }'

# Step 2 — Index all corpora (runs as background jobs)
MED=$(curl -s -X POST http://localhost:4005/rag/index/medications \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d '{"limit":0}' | python3 -c "import sys,json; print(json.load(sys.stdin)['job_id'])")
echo "Medications job: $MED"

FDA=$(curl -s -X POST http://localhost:4005/rag/index/fda-labels \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d '{}' | python3 -c "import sys,json; print(json.load(sys.stdin)['job_id'])")
echo "FDA labels job: $FDA"

LOINC=$(curl -s -X POST http://localhost:4005/rag/index/loinc \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d '{}' | python3 -c "import sys,json; print(json.load(sys.stdin)['job_id'])")
echo "LOINC job: $LOINC"

# Step 3 — Poll jobs until done
for JID in $MED $FDA $LOINC; do
  until [ "$(curl -s "http://localhost:4005/rag/jobs/$JID" \
    -H "Authorization: Bearer $JWT" | \
    python3 -c "import sys,json; print(json.load(sys.stdin)['status'])")" = "done" ]; do
    sleep 10; printf "."
  done; echo " $JID done"
done

# Step 4 — Test the new model before promoting
curl -s -X POST http://localhost:4005/rag/models/main-v2/test \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d '{
    "questions": [
      "What is Metformin prescribed for?",
      "Normal HbA1c range for diabetes?",
      "Drug interactions for Warfarin Sodium"
    ]
  }' | python3 -m json.tool

# Step 5 — Promote to active if tests pass
curl -s -X PUT http://localhost:4005/rag/models/main-v2/activate \
  -H "Authorization: Bearer $JWT" | python3 -m json.tool
```

---

### 12.4 Steps to Generate a Test Model

```bash
# Register a lightweight test model (LOINC only, Nova Lite)
curl -s -X POST http://localhost:4005/rag/models/ \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "name":         "test-v2",
    "label":        "CI Test Model — LOINC + Nova Lite",
    "embed_backend": "clinicalbert",
    "llm_backend":  "bedrock",
    "llm_model":    "amazon.nova-lite-v1:0",
    "shard_filter": "loinc",
    "top_k":        3,
    "alpha":        0.5,
    "description":  "Fast CI model: LOINC shard only, Nova Lite (lower cost)"
  }'

# Run the built-in test suite
curl -s -X POST http://localhost:4005/rag/models/test-v2/test \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d '{
    "questions": [
      "What is the normal HbA1c range?",
      "Normal blood pressure range?",
      "Reference range for hemoglobin?"
    ],
    "mode": "standard"
  }' | python3 -c "
import sys, json
results = json.load(sys.stdin)
passed = sum(1 for r in results if not r.get('error'))
print(f'Test results: {passed}/{len(results)} passed')
for r in results:
    status = 'PASS' if not r.get('error') else 'FAIL'
    print(f'  [{status}] {r[\"question\"][:50]}')
    print(f'         latency={r[\"latency_ms\"]}ms tokens={r[\"tokens_total\"]}')
"
```

---

### 12.5 AWS CLI Commands — Bedrock Model Management

```bash
# List all foundation models available in your account
aws bedrock list-foundation-models \
  --by-output-modality TEXT \
  --region us-east-1 \
  --query "modelSummaries[*].{ID:modelId,Name:modelName}" \
  --output table

# List cross-region inference profiles (required for Claude)
aws bedrock list-inference-profiles \
  --region us-east-1 \
  --query "inferenceProfileSummaries[*].{ID:inferenceProfileId,Status:status}" \
  --output table

# Check your current IAM identity (must have bedrock-runtime:InvokeModel)
aws sts get-caller-identity

# Test invoking Nova Pro directly from CLI
aws bedrock-runtime invoke-model \
  --model-id amazon.nova-pro-v1:0 \
  --body '{"messages":[{"role":"user","content":[{"text":"What is Metformin?"}]}],"inferenceConfig":{"maxTokens":100}}' \
  --content-type application/json \
  --accept application/json \
  /tmp/bedrock-test-output.json && cat /tmp/bedrock-test-output.json

# Test invoking Claude Sonnet 4.6 via inference profile
aws bedrock-runtime invoke-model \
  --model-id us.anthropic.claude-sonnet-4-6 \
  --body '{"anthropic_version":"bedrock-2023-05-31","max_tokens":100,"messages":[{"role":"user","content":"What is Metformin?"}]}' \
  --content-type application/json \
  --accept application/json \
  /tmp/claude-test-output.json && cat /tmp/claude-test-output.json

# Get model invocation logging status (useful for audit)
aws bedrock get-model-invocation-logging-configuration --region us-east-1

# Enable model invocation logging to S3 (recommended for production)
aws bedrock put-model-invocation-logging-configuration \
  --logging-config '{
    "s3Config": {
      "bucketName": "dgs-glue-staging",
      "keyPrefix": "bedrock-logs/"
    },
    "textDataDeliveryEnabled": true,
    "imageDataDeliveryEnabled": false
  }' \
  --region us-east-1

# View available embedding models (for RAG_EMBED_BACKEND=bedrock)
aws bedrock list-foundation-models \
  --by-output-modality EMBEDDING \
  --region us-east-1 \
  --query "modelSummaries[*].modelId" \
  --output text
```

---

### 12.6 Swagger — Viewing All Three Models

With the RAG API running, open Swagger UI and navigate to the **Models** tag:

| URL | Access |
|---|---|
| http://localhost:4005/docs#/Models | Live Swagger (server must be running) |
| Open `rag-api/rag-swagger/index.html` | Static standalone (no server needed) |

**Models tag endpoints visible in Swagger:**

```
GET    /rag/models/               List All Models
POST   /rag/models/               Register a New Model
GET    /rag/models/{name}         Get One Model
PUT    /rag/models/{name}/activate  Activate Model
POST   /rag/models/{name}/test    Run Test Queries
DELETE /rag/models/{name}         Delete Model
```

The `GET /rag/models/` response shows all three models side-by-side:

```json
[
  {
    "name": "main",       "is_active": true,
    "llm_model": "amazon.nova-pro-v1:0",
    "doc_count": 516,     "shard_filter": null,
    "test_pass": null,    "last_tested": null
  },
  {
    "name": "test",       "is_active": false,
    "llm_model": "amazon.nova-lite-v1:0",
    "doc_count": 16,      "shard_filter": "loinc",
    "test_pass": true,    "last_tested": "2026-07-06T20:01:20Z"
  },
  {
    "name": "staging",    "is_active": false,
    "llm_model": "us.anthropic.claude-sonnet-4-6",
    "doc_count": 516,     "shard_filter": null,
    "test_pass": null,    "last_tested": null
  }
]
```


---

## 13. Vector Dimensions — Rationale and Selection Guide

### 13.1 What Is a Vector Dimension?

When the embedder converts a clinical text string into a vector, it produces a list
of floating-point numbers — one number per **dimension**.  For example, the sentence
*"Patient prescribed Metformin 500 MG for diabetes"* becomes a point in 768-dimensional
space.  Clinically similar texts (both about Metformin, both about diabetes) end up
geometrically **close together**; unrelated texts (a blood pressure reading, a payer ID)
end up **far apart**.

The similarity between two vectors is measured by **cosine similarity**:

$$\text{similarity}(A, B) = \frac{A \cdot B}{\|A\| \cdot \|B\|}$$

A score of **1.0** means identical direction (same clinical concept); **0.0** means
completely orthogonal (unrelated concepts); **−1.0** means opposite.

---

### 13.2 Dimensions in This Project

| Embedding Backend | Model | Dimensions | Why This Number |
|---|---|---|---|
| **ClinicalBERT** *(default)* | `pritamdeka/S-PubMedBert-MS-MARCO` | **768** | BERT-base architecture — 12 transformer layers × 64 attention head size = 768. Fixed by the model architecture. |
| **OpenAI** | `text-embedding-3-small` | **1536** | OpenAI's compressed representation. The full model (`text-embedding-3-large`) uses 3072. Configurable via `dimensions` parameter. |
| **Amazon Bedrock** | `amazon.titan-embed-text-v2:0` | **1024** | AWS Titan's chosen capacity — larger than BERT-base but smaller than OpenAI large. |

The dimension count is **set by the model** — you cannot change it without switching
to a different model.  It is printed at startup:

```
INFO  rag.embedder — Embedder ready dim=768 backend=clinicalbert
```

---

### 13.3 Why 768 Was Chosen for This Healthcare Project

**1. Domain alignment is more important than raw size**

`pritamdeka/S-PubMedBert-MS-MARCO` was pre-trained on **PubMed biomedical abstracts**
and fine-tuned on **MS MARCO** (a passage retrieval benchmark).  It understands:
- Drug names (`Metformin`, `Warfarin Sodium 5 MG`)
- Clinical codes (`LOINC 4548-4`, `SNOMED 162864005`)
- Medical phrases (`HbA1c`, `prediabetes`, `INR monitoring`)

A generic 1536-dim OpenAI model does not have this specialised understanding.
A domain-specific 768-dim model outperforms a generic 1536-dim model on
biomedical retrieval benchmarks (see BEIR-Medical leaderboard).

**2. Inference speed and memory**

| Dimension | Memory per 10 000 docs | Cosine search time (CPU) |
|---|---|---|
| 768 | ~30 MB | ~5 ms |
| 1536 | ~60 MB | ~10 ms |
| 3072 | ~120 MB | ~20 ms |

At 371,806 medication records, 768-dim vectors occupy **~1.1 GB** in the memory
store — feasible on a single EC2 `t3.medium` (4 GB RAM).  1536-dim would require
~2.2 GB, pushing toward `t3.large`.

**3. Cosine similarity is normalised — larger ≠ more accurate**

After L2 normalisation (applied by sentence-transformers automatically), cosine
similarity is bounded to [−1, 1] regardless of dimension.  768 dimensions already
capture enough clinical semantics for high-quality passage retrieval.

---

### 13.4 The Curse of Dimensionality

Counterintuitively, **more dimensions can hurt retrieval quality** when:
- The training corpus is small (overfitting)
- The query distribution differs from the training data
- ANN index build time grows as O(d · n · log n)

For clinical text over a DynamoDB-sourced corpus like this project:
768 dimensions hits the sweet spot — expressive enough for biomedical retrieval,
fast enough for real-time query answering (< 10 ms cosine search over 500 docs).

---

### 13.5 When to Switch to Higher Dimensions

| Scenario | Recommended model | Dimensions |
|---|---|---|
| PHI must stay on-premises | `pritamdeka/S-PubMedBert-MS-MARCO` | 768 |
| Best retrieval quality, API budget available | `text-embedding-3-large` | 3072 |
| AWS-native, no external API | `amazon.titan-embed-text-v2:0` | 1024 |
| Multilingual clinical records | `intfloat/multilingual-e5-large` | 1024 |
| Very large corpus (> 1M docs) + OpenSearch | `text-embedding-3-small` | 1536 |

Change the backend by setting one environment variable in `.env`:

```bash
# Switch from ClinicalBERT to OpenAI (re-index corpus after switching)
RAG_EMBED_BACKEND=openai
OPENAI_API_KEY=sk-...

# Or Amazon Bedrock Titan (no API key, uses IAM)
RAG_EMBED_BACKEND=bedrock
```

> **Important:** After changing the embedding model you **must re-index the entire corpus**.
> Vectors from different models are not comparable — mixing them will produce
> meaningless similarity scores.  Run `DELETE /rag/index` then all
> `POST /rag/index/*` endpoints again.

---

### 13.6 How Dimensions Flow Through the Code

```
Text string
    │
    ▼
rag/embedder.py  Embedder.embed(text)
    │  model.encode([text], normalize_embeddings=True)
    │  returns np.ndarray shape=(768,) dtype=float32
    ▼
rag/vector_store.py  VectorStore.upsert_batch(documents)
    │  stores np.array(vector, dtype=float32)  →  16 KB per document at 768-dim (float16: 8 KB)
    ▼
rag/vector_store.py  VectorStore.search(query_vector, top_k)
    │  matrix = np.stack([doc.vector for doc in docs])  # shape (N, 768)
    │  scores  = matrix @ q / (||matrix|| * ||q||)       # cosine similarity
    │  top_idx = np.argsort(-scores)[:top_k]             # rank by score
    ▼
rag/retriever.py  HybridRetriever  (fused with BM25 via RRF)
    ▼
rag/generator.py  Generator  (LLM call with retrieved passages)
```

The dimension value is checked at startup by `Embedder.dimension()` and logged.
If the stored pickle file was created with a different model dimension than the
current one, the cosine search will fail or produce nonsense results — the server
logs a warning in that case.


---

## 14. Use-Case APIs — Pharmacist Review, EHR Query, Diagnosis Support

Three focused FastAPI applications built on top of the core RAG API.
Each is a thin proxy layer that provides a domain-specific interface and
Swagger UI, calling `POST /rag/query` on the core RAG API internally.

---

### 14.1 Architecture Pattern

```
Browser / Client
      │
      ▼
┌─────────────┐   ┌─────────────┐   ┌──────────────────┐
│  Pharmacist │   │  EHR Query  │   │ Diagnosis Support │
│  Review API │   │     API     │   │       API        │
│   :4006     │   │   :4007     │   │      :4008       │
└──────┬──────┘   └──────┬──────┘   └────────┬─────────┘
       │                 │                   │
       │   RAG_JWT (service-to-service token)│
       │                 │                   │
       └─────────────────▼───────────────────┘
                         │
                    POST /rag/query
                         │
                         ▼
                ┌─────────────────┐
                │  Core RAG API   │
                │    :4005        │
                │ Claude Sonnet   │
                │ 1,036 doc corpus│
                └─────────────────┘
```

The use-case APIs are **stateless** — they contain no ML code, no vector stores,
and no LLM calls.  All intelligence is in the core RAG API.
A `RAG_JWT` service-account token (set in `.env`) authenticates them.

---

### 14.2 Pharmacist Review API — `pharmacist_review.py`

**Port:** 4006 · **Swagger:** http://localhost:4006/docs · **Colour:** Red

Provides Drug-Related Problem (DRP) identification using FDA drug label corpus
and the RAG `copilot` mode.  Every finding is cited with `[source: fda-...]` notation.

#### Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Open — no auth |
| `POST` | `/review/medication` | PCNE DRP report for one drug name |
| `POST` | `/review/patient/{patient_id}` | Full DRP review for all active patient medications |
| `POST` | `/review/interaction` | Drug-drug interaction check between 2+ drugs |

#### Example — Drug Interaction Check

```bash
curl -X POST http://localhost:4006/review/interaction \
  -H "Content-Type: application/json" \
  -d '{"drugs": ["Warfarin Sodium 5 MG", "Naproxen 500 MG"]}'
```

**Response:**
```
1. PROBLEM: Increased bleeding risk
2. CAUSE: Naproxen displaces Warfarin from plasma protein binding sites
   [source: fda-198014-drug_interactions-0]
3. SEVERITY: NCC MERP Category D
4. INTERVENTION: Monitor INR; consider acetaminophen instead
```

---

### 14.3 EHR Natural Language Query API — `ehr_query.py`

**Port:** 4007 · **Swagger:** http://localhost:4007/docs · **Colour:** Blue

Converts plain-English EHR questions into DynamoDB PartiQL SELECT statements
using the RAG `sql` mode.  Clinical staff with no SQL knowledge can query the
medications, conditions, and observations tables by description.

#### Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Open — no auth |
| `GET` | `/ehr/tables` | List all queryable DynamoDB table names |
| `POST` | `/ehr/query` | Natural language → PartiQL (returned, not executed) |
| `POST` | `/ehr/query/explain` | Explain what data a question would retrieve |

#### Example — NL to PartiQL

```bash
curl -X POST http://localhost:4007/ehr/query \
  -d '{"question": "Find patients on Warfarin after 2015 with cost over $50"}'
```

**Generated PartiQL:**
```sql
SELECT * FROM medications
WHERE medication_name = 'Warfarin Sodium'
  AND start_date > '2015-01-01T00:00:00.000Z'
  AND total_cost > 50
```

---

### 14.4 Diagnosis Support API — `diagnosis_support.py`

**Port:** 4008 · **Swagger:** http://localhost:4008/docs · **Colour:** Green

Generates evidence-based differential diagnoses using the GARMLE-G framework
(arXiv:2506.21615) with the RAG `diagnosis` mode.
Every diagnosis includes an ICD-10/SNOMED code and a CPG citation.

#### Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Open — no auth |
| `POST` | `/diagnosis/evaluate` | Full GARMLE-G diagnosis from lab values + medications |
| `POST` | `/diagnosis/patient/{patient_id}` | Diagnosis from DynamoDB EHR records (PACE-RAG) |
| `POST` | `/diagnosis/lab` | Interpret one lab value with LOINC reference range |

#### Example — Lab Value Interpretation

```bash
curl -X POST http://localhost:4008/diagnosis/lab \
  -d '{"lab_name":"HbA1c","value":"8.1%","loinc_code":"4548-4",
       "patient_conditions":["type 2 diabetes"]}'
```

**Response:**
```
HbA1c 8.1% is abnormal — ≥6.5% indicates diabetes [source: loinc-4548-4].
Poor glycaemic control over past 2–3 months. ADA recommends < 7% target.
Increased risk of diabetic complications at current level.
```

---

### 14.5 Running the Use-Case APIs

```bash
# All 3 start automatically with the full stack
bash /tmp/start-all.sh

# Or individually
cd rag-api
source .env                  # loads RAG_JWT, RAG_URL, etc.
uvicorn pharmacist_review:app --port 4006 &
uvicorn ehr_query:app         --port 4007 &
uvicorn diagnosis_support:app --port 4008 &
```

**Service-to-service authentication** — the use-case APIs need a `RAG_JWT` token
to call the core RAG API's protected endpoints.  Generate a fresh token:

```bash
python -c "
import jwt, time
token = jwt.encode(
    {'sub':'svc-account', 'role':'admin', 'scopes':[],
     'iat': int(time.time()), 'exp': int(time.time()) + 86400},
    'hc-local-secret', algorithm='HS256'
)
print(token)
"
```

Set it in `rag-api/.env` as `RAG_JWT=<token>` — expires every 24 hours.

---

### 14.6 Swagger Files

All Swagger specs are in `rag-api/rag-swagger/`:

| File | Opens | Description |
|---|---|---|
| `index-pharmacist.html` | Pharmacist Review Swagger (red) | 4 endpoints |
| `index-ehr-query.html` | EHR Query Swagger (blue) | 4 endpoints |
| `index-diagnosis.html` | Diagnosis Support Swagger (green) | 4 endpoints |
| `openapi-pharmacist.json` | Raw OpenAPI spec | 3.1.0 |
| `openapi-ehr-query.json` | Raw OpenAPI spec | 3.1.0 |
| `openapi-diagnosis.json` | Raw OpenAPI spec | 3.1.0 |

Open any `.html` file in a browser — no server required (loads via CDN Swagger UI).

---

*Generated: 2026-07-06*  
*Branch: django | Repo: PacktPublishing/RESTful-Web-API-Design-with-Node.js-10-Third-Edition*
