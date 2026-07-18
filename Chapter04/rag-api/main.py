"""
main.py — FastAPI application entry point for the Healthcare RAG API.
"""
import logging
import json
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse as _BaseJSONResponse
from config import settings
from routers import rag as rag_router
from routers import models as models_router


class IndentedJSONResponse(_BaseJSONResponse):
    """Renders all API responses as pretty-printed JSON with 2-space indentation."""
    def render(self, content) -> bytes:
        return json.dumps(
            content,
            ensure_ascii=False,
            allow_nan=False,
            indent=2,
            separators=(",", ": "),
        ).encode("utf-8")


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(
        "RAG API starting — embed=%s vector=%s llm=%s port=%d",
        settings.rag_embed_backend,
        settings.rag_vector_backend,
        settings.rag_llm_backend,
        settings.port,
    )
    yield
    logger.info("RAG API shutting down")


app = FastAPI(
    title="Healthcare RAG API",
    description=(
        "Retrieval-Augmented Generation for clinical medication intelligence. "
        "Indexes medications, FDA labels, SNOMED, LOINC, and clinical guidelines. "
        "Research: Lewis 2020, PACE-RAG 2603.17356, REALM 2402.07016, EMERGE 2406.00036."
    ),
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
    default_response_class=IndentedJSONResponse,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(rag_router.router, prefix="/rag", tags=["RAG"])
app.include_router(models_router.router, prefix="/rag/models", tags=["Models"])


@app.get("/health", tags=["Health"])
async def health():
    return {
        "status": "ok",
        "service": "rag-api",
        "embed_backend": settings.rag_embed_backend,
        "vector_backend": settings.rag_vector_backend,
        "llm_backend": settings.rag_llm_backend,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=settings.port, reload=True)
