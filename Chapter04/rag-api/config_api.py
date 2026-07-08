# Databricks notebook source
"""
config_api.py — Configuration & Documentation Browser API.

PURPOSE
-------
Serves project documentation and configuration files over HTTP so they can be
browsed from the TypeScript frontend or Swagger UI.

SECURITY — SECRET REDACTION
-----------------------------
Any value matching a sensitive pattern is replaced with # characters before
the content is returned.  The original file on disk is NEVER modified.

Patterns redacted:
  .env / shell   KEY=value       where KEY name contains SECRET|PASSWORD|JWT|TOKEN|KEY|APIKEY
  JSON           "field": "val"  where field name is secret-like
  Any file       JWT tokens      eyJ...(base64).(base64).(base64)
  Any file       OpenAI keys     sk-[alphanum]
  Any file       Long hex/b64    40+ char random strings after = or :

PORT: 4009
SWAGGER: http://localhost:4009/docs
"""

import os, re, json, pathlib, sqlite3
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional

# ── File registry ─────────────────────────────────────────────────────────────
_here     = os.path.dirname(os.path.abspath(__file__))
_root     = os.path.dirname(_here)
_swagger  = os.path.join(_here, "rag-swagger")

FILE_REGISTRY: dict[str, dict] = {
    "readme": {
        "id": "readme", "label": "RAG Architecture README",
        "path": os.path.join(_root, "RAG-architecture readme.md"),
        "type": "markdown", "category": "docs",
        "description": "Full project documentation — 14 sections covering architecture, APIs, IAM, vector dimensions, use-case APIs",
    },
    "env": {
        "id": "env", "label": ".env (active, secrets redacted)",
        "path": os.path.join(_here, ".env"),
        "type": "env", "category": "config",
        "description": "Active environment configuration. All secret values are replaced with # characters.",
    },
    "env-example": {
        "id": "env-example", "label": ".env.example (template)",
        "path": os.path.join(_here, ".env.example"),
        "type": "env", "category": "config",
        "description": "Configuration template with all supported variables documented.",
    },
    "iam-policy": {
        "id": "iam-policy", "label": "AWS IAM Policy (least privilege)",
        "path": os.path.join(_here, "aws-iam-policy.json"),
        "type": "json", "category": "aws",
        "description": "Minimum IAM permissions for running the RAG API on EC2 or ECS.",
    },
    "iam-trust-ec2": {
        "id": "iam-trust-ec2", "label": "EC2 Instance Role — Trust Policy",
        "path": os.path.join(_here, "aws-iam-trust-ec2.json"),
        "type": "json", "category": "aws",
        "description": "IAM trust policy for attaching the RAG API permissions to an EC2 instance profile.",
    },
    "iam-trust-ecs": {
        "id": "iam-trust-ecs", "label": "ECS Task Role — Trust Policy",
        "path": os.path.join(_here, "aws-iam-trust-ecs.json"),
        "type": "json", "category": "aws",
        "description": "IAM trust policy for the ECS Fargate task role used in docker-compose.ec2.yml.",
    },
    "bedrock-models": {
        "id": "bedrock-models", "label": "Bedrock Model ID Reference",
        "path": os.path.join(_here, "aws-bedrock-models-ref.json"),
        "type": "json", "category": "aws",
        "description": "Quick reference for Bedrock model IDs — Nova uses direct IDs, Claude requires inference profile prefix.",
    },
    "openapi-core": {
        "id": "openapi-core", "label": "Core RAG API — OpenAPI spec",
        "path": os.path.join(_swagger, "openapi.json"),
        "type": "json", "category": "swagger",
        "description": "OpenAPI 3.1.0 spec for the core RAG API (17 paths, 5 tags).",
    },
    "openapi-pharmacist": {
        "id": "openapi-pharmacist", "label": "Pharmacist Review API — OpenAPI spec",
        "path": os.path.join(_swagger, "openapi-pharmacist.json"),
        "type": "json", "category": "swagger",
        "description": "OpenAPI spec for the DRP review use-case API (port 4006).",
    },
    "openapi-ehr": {
        "id": "openapi-ehr", "label": "EHR Query API — OpenAPI spec",
        "path": os.path.join(_swagger, "openapi-ehr-query.json"),
        "type": "json", "category": "swagger",
        "description": "OpenAPI spec for the EHR natural language query API (port 4007).",
    },
    "openapi-diagnosis": {
        "id": "openapi-diagnosis", "label": "Diagnosis Support API — OpenAPI spec",
        "path": os.path.join(_swagger, "openapi-diagnosis.json"),
        "type": "json", "category": "swagger",
        "description": "OpenAPI spec for the GARMLE-G diagnosis API (port 4008).",
    },
    "startup-script": {
        "id": "startup-script", "label": "startup-all.sh — Start all services",
        "path": os.path.join(_root, "startup-all.sh"),
        "type": "shell", "category": "docs",
        "description": "Bash script that launches all 5 Python backends and 2 Vite frontends. Run: bash startup-all.sh  |  Stop: bash startup-all.sh stop",
    },
}

# ── Secret redaction ──────────────────────────────────────────────────────────

# Env-file lines: NAME=value  (redact value when name looks sensitive)
_ENV_SECRET_NAME = re.compile(
    r"^([A-Z_]*(?:SECRET|PASSWORD|JWT|TOKEN|KEY|APIKEY|API_KEY|SMTP)[A-Z_]*)\s*=\s*(.+)$",
    re.IGNORECASE | re.MULTILINE,
)

# JSON field: "name": "value"  (redact value when field name looks sensitive)
_JSON_SECRET_FIELD = re.compile(
    r'("(?:[^"]*(?:secret|password|jwt|token|api_key|apikey|key)[^"]*)")\s*:\s*"([^"]{4,})"',
    re.IGNORECASE,
)

# JWT bearer tokens:  eyJ<base64>.<base64>.<base64>
_JWT_TOKEN = re.compile(
    r"eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}"
)

# OpenAI / Anthropic API key patterns
_API_KEY_INLINE = re.compile(r"\bsk-[A-Za-z0-9\-_]{20,}")

# Long random-looking hex / base64 after = (40+ chars, only alphanum + /+= _-)
_LONG_SECRET = re.compile(
    r"(?<==\s)([A-Za-z0-9+/=_\-]{40,})"
)


def _mask(value: str) -> str:
    """Replace a secret value with # characters (keep length up to 24)."""
    return "#" * min(len(value), 24)


def redact(content: str) -> str:
    """Apply all secret redaction rules to a string. Returns sanitised content."""
    # JWT tokens (most specific — do first)
    content = _JWT_TOKEN.sub(lambda m: "eyJ" + "#" * 20 + ".[REDACTED_JWT]", content)

    # OpenAI/Anthropic keys
    content = _API_KEY_INLINE.sub(lambda m: "sk-" + "#" * 20, content)

    # .env style KEY=VALUE
    def _redact_env_line(m: re.Match) -> str:
        return f"{m.group(1)}={_mask(m.group(2))}"
    content = _ENV_SECRET_NAME.sub(_redact_env_line, content)

    # JSON "field": "value"
    def _redact_json_field(m: re.Match) -> str:
        return f'{m.group(1)}: "{_mask(m.group(2))}"'
    content = _JSON_SECRET_FIELD.sub(_redact_json_field, content)

    # Long random secrets after =
    content = _LONG_SECRET.sub(lambda m: _mask(m.group(1)), content)

    return content


# ── FastAPI app ───────────────────────────────────────────────────────────────

app = FastAPI(
    title="Config & Documentation Browser API",
    description=(
        "## Browse project configuration and documentation files\n\n"
        "Serves the RAG API's README, `.env`, IAM policies, and Swagger specs "
        "over HTTP.  **All secret values are automatically redacted** — replaced "
        "with `#` characters before being sent to the client.\n\n"
        "Redaction covers: JWT tokens · API keys · passwords · env var secrets · "
        "long random strings.\n\n"
        "**No authentication required** — the redaction makes every response safe to share."
    ),
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware, allow_origins=["*"],
    allow_methods=["GET"], allow_headers=["*"],
)


class FileEntry(BaseModel):
    id: str
    label: str
    type: str
    category: str
    description: str
    exists: bool
    size_bytes: Optional[int]


class FileContent(BaseModel):
    id: str
    label: str
    type: str
    content: str
    redacted: bool
    size_bytes: int


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/health", tags=["Health"], summary="Service health check")
def health():
    return {"status": "ok", "service": "config-api", "files_registered": len(FILE_REGISTRY)}


@app.get("/config/files", response_model=list[FileEntry], tags=["Config Browser"],
    summary="List all available files",
    description="Returns all registered documentation and configuration files with metadata.")
def list_files() -> list[FileEntry]:
    result = []
    for info in FILE_REGISTRY.values():
        exists = os.path.exists(info["path"])
        size   = os.path.getsize(info["path"]) if exists else None
        result.append(FileEntry(
            id=info["id"], label=info["label"], type=info["type"],
            category=info["category"], description=info["description"],
            exists=exists, size_bytes=size,
        ))
    return result


@app.get("/config/file/{file_id}", response_model=FileContent, tags=["Config Browser"],
    summary="Get file content (secrets redacted)",
    description=(
        "Returns the full text content of the requested file.\n\n"
        "**Secret values are automatically replaced with `#` characters.**\n\n"
        "Redacted patterns:\n"
        "- JWT bearer tokens (`eyJ...`)\n"
        "- API keys (`sk-...`)\n"
        "- `.env` values where the key name contains SECRET / PASSWORD / JWT / TOKEN / KEY\n"
        "- JSON fields with secret-like names\n"
        "- Long random strings (40+ chars) appearing after `=`"
    ))
def get_file(file_id: str) -> FileContent:
    info = FILE_REGISTRY.get(file_id)
    if not info:
        raise HTTPException(404, f"File '{file_id}' not registered. Use GET /config/files to list available files.")
    if not os.path.exists(info["path"]):
        raise HTTPException(404, f"File '{file_id}' is registered but does not exist on disk yet.")
    with open(info["path"], encoding="utf-8", errors="replace") as f:
        raw = f.read()
    sanitised = redact(raw)
    return FileContent(
        id=info["id"], label=info["label"], type=info["type"],
        content=sanitised, redacted=(sanitised != raw),
        size_bytes=len(sanitised.encode()),
    )


@app.get("/config/readme", response_model=FileContent, tags=["Config Browser"],
    summary="Get the RAG Architecture README (markdown)")
def get_readme() -> FileContent:
    return get_file("readme")


@app.get("/config/env", response_model=FileContent, tags=["Config Browser"],
    summary="Get .env file (all secrets redacted)")
def get_env() -> FileContent:
    return get_file("env")



# ── SQLite — drug_conditions reference table ──────────────────────────────────


import boto3 as _boto3
_DDB_TABLE  = os.getenv("DHRUG_CONDITIONS_TABLE", "drug-conditions")
_DDB_REGION = os.getenv("AWS_REGION", "us-east-1")

def _ddb():
    return _boto3.client("dynamodb", region_name=_DDB_REGION)



class DrugConditionRow(BaseModel):
    drug_name:  str
    conditions: str


@app.get("/config/drug-conditions", response_model=dict[str, str], tags=["Drug Conditions"],
    summary="Get all drug → conditions mappings")
def list_drug_conditions() -> dict[str, str]:
    try:
        resp = _ddb().scan(TableName=_DDB_TABLE)
        return {item["drug_name"]["S"]: item["conditions"]["S"]
                for item in resp.get("Items", [])}
    except Exception as exc:
        raise HTTPException(502, detail=f"DynamoDB error: {exc}")


@app.put("/config/drug-conditions/{drug_name:path}", response_model=DrugConditionRow,
    tags=["Drug Conditions"], summary="Create or update conditions for a drug")
def upsert_drug_conditions(drug_name: str, body: DrugConditionRow) -> DrugConditionRow:
    try:
        _ddb().put_item(TableName=_DDB_TABLE,
                        Item={"drug_name":{"S":drug_name},"conditions":{"S":body.conditions}})
        return DrugConditionRow(drug_name=drug_name, conditions=body.conditions)
    except Exception as exc:
        raise HTTPException(502, detail=f"DynamoDB error: {exc}")


@app.delete("/config/drug-conditions/{drug_name:path}", tags=["Drug Conditions"],
    summary="Delete a drug conditions entry")
def delete_drug_conditions(drug_name: str) -> dict:
    try:
        _ddb().delete_item(TableName=_DDB_TABLE,
                            Key={"drug_name":{"S":drug_name}})
        return {"deleted": drug_name}
    except Exception as exc:
        raise HTTPException(502, detail=f"DynamoDB error: {exc}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("config_api:app", host="0.0.0.0",
                port=int(os.getenv("PORT", "4009")), reload=True)
