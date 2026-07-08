"""
config.py — Application-wide settings for the Healthcare RAG API.

PURPOSE
-------
Centralises every configurable value in one typed object (Settings).
All values can be overridden at runtime via environment variables or a .env file,
making the same codebase work on a developer laptop, an EC2 instance, and in Docker
without changing source code.

HOW IT WORKS
------------
pydantic-settings reads the OS environment (and optionally a .env file), validates
each field's type, and exposes them as Python attributes.  FastAPI routes import
`settings` directly:

    from config import settings
    print(settings.rag_llm_backend)   # "bedrock"

CONFIGURATION GROUPS
--------------------
RAG_EMBED_BACKEND    Which embedding model to use.
                       clinicalbert  — local ClinicalBERT (no API key, default)
                       openai        — OpenAI text-embedding-3-small
                       bedrock       — Amazon Titan Embed v2

RAG_VECTOR_BACKEND   Where to store document vectors.
                       memory        — in-process numpy array + pickle file (default)
                       opensearch    — AWS OpenSearch for production scale
                       pgvector      — PostgreSQL + pgvector extension

RAG_LLM_BACKEND      Which language model generates answers.
                       bedrock       — Amazon Nova Pro / Claude via AWS Bedrock (default)
                       openai        — GPT-4o via OpenAI API
                       ollama        — local Llama 3.1 (privacy-preserving)

JWT_SECRET           Shared secret for verifying Bearer tokens.
                     Must match the Flask/Django backend's JWT_SECRET.

CLASS
-----
Settings(BaseSettings)
    Pydantic settings class.  All fields map 1-to-1 with an environment variable
    (snake_case → upper_case automatically, e.g. rag_top_k → RAG_TOP_K).
    llm_model_name() → str   Returns the correct Bedrock/OpenAI model ID,
                              applying per-backend defaults if RAG_LLM_MODEL is unset.

settings  (module-level singleton)
    Instantiated once at import time.  Import this object, not the class.
"""

from __future__ import annotations
from typing import Optional
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8",
                                      extra="ignore", case_sensitive=False)
    rag_embed_backend: str = "clinicalbert"
    rag_clinicalbert_model: str = "pritamdeka/S-PubMedBert-MS-MARCO"
    rag_vector_backend: str = "memory"
    rag_opensearch_url: Optional[str] = None
    rag_opensearch_index: str = "healthcare-rag"
    rag_pg_dsn: Optional[str] = None
    rag_memory_store_path: str = "/tmp/rag-memory-store.pkl"
    rag_llm_backend: str = "openai"
    rag_llm_model: Optional[str] = None
    rag_ollama_url: str = "http://localhost:11434"
    rag_top_k: int = 5
    rag_alpha: float = 0.6
    rag_chunk_size: int = 400
    rag_chunk_overlap: int = 50
    openai_api_key: Optional[str] = None
    umls_api_key: Optional[str] = None
    aws_region: str = "us-east-1"
    dynamodb_table: str = "medications"
    staging_bucket: str = "dgs-glue-staging"
    jwt_secret: str = "healthcare-local-dev-secret"
    port: int = 4005
    cors_origins: list[str] = [
        "http://localhost:5173","http://localhost:5174","http://localhost:5175",
        "http://localhost:5177","http://localhost:5176","http://localhost:8080",
    ]

    @field_validator("cors_origins", mode="before")
    @classmethod
    def split_cors(cls, v):
        if isinstance(v, str):
            return [o.strip() for o in v.split(",") if o.strip()]
        return v

    def llm_model_name(self) -> str:
        if self.rag_llm_model:
            return self.rag_llm_model
        return {"openai": "gpt-4o", "bedrock": "amazon.nova-pro-v1:0",
                "ollama": "llama3.1:8b"}.get(self.rag_llm_backend, "gpt-4o")

settings = Settings()
