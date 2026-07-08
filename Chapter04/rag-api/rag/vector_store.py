"""
rag/vector_store.py — Stores and searches embedded document vectors.

PURPOSE
-------
After the embedder turns each clinical text passage into a vector, those vectors
must be stored somewhere so they can be searched quickly at query time.

This module provides a unified VectorStore interface with multiple backends.
The "memory" backend is fully functional for development and single-node production;

WHAT IS COSINE SIMILARITY SEARCH?
-----------------------------------
Given a query vector (the embedded question), the vector store ranks all stored
document vectors by their cosine similarity to the query:

    similarity = (A · B) / (||A|| × ||B||)

A score of 1.0 means the document is semantically identical to the query.
A score near 0.0 means it is unrelated.  The top-k highest-scoring documents
are returned as the "retrieved passages" for the LLM.

WHAT IS BM25?
-------------
BM25 (Best Match 25) is a classical keyword-ranking algorithm.  It scores
documents based on term frequency and inverse document frequency — how often
the query words appear in each document.  BM25 is excellent at finding exact
drug names ("Warfarin Sodium 5 MG") that dense vectors might miss.

The vector store exposes both search() (cosine/ANN) and bm25_search() so
the HybridRetriever can combine both.

SUPPORTED BACKENDS (RAG_VECTOR_BACKEND env var)
-------------------------------------------------
memory      In-process numpy array + pickle file on disk.
            Up to ~100k documents on a t3.medium EC2 instance.
            Pickle file survives server restarts.


pgvector    PostgreSQL + pgvector extension.
            SQL-compatible vector search.  Good for existing Postgres setups.

CLASS
-----
VectorStore(backend: str, index_name: str)
    Thread-safe (uses threading.RLock) vector store abstraction.

    create_index(dimension, shards)   Create the index if it does not exist.
    delete_index(shard)               Delete all documents or one named shard.
    upsert(doc_id, vector, ...)       Insert or update one document.
    upsert_batch(documents)           Bulk insert — more efficient than upsert().
    search(query_vector, top_k, ...)  ANN cosine similarity search.
    bm25_search(query_text, top_k)    BM25 keyword search.
    stats() -> dict                   Returns per-shard doc counts and timestamps.

_Doc (dataclass, internal)
    Represents one stored document: doc_id, vector (np.ndarray), text, source,
    shard, metadata, indexed_at.
"""

import logging, os, pickle, threading, time
from dataclasses import dataclass, field
import numpy as np
logger = logging.getLogger(__name__)

@dataclass
class _Doc:
    doc_id: str
    vector: object  # np.ndarray
    text: str
    source: str
    shard: str
    metadata: dict = field(default_factory=dict)
    indexed_at: float = field(default_factory=time.time)

class VectorStore:
    def __init__(self, backend="memory", index_name="healthcare-rag"):
        self.backend = backend
        self.index_name = index_name
        self._lock = threading.RLock()
        if backend == "memory":
            self._store_path = os.getenv("RAG_MEMORY_STORE_PATH","/tmp/rag-memory-store.pkl")
            self._docs = []
            self._bm25_index = None
            self._load_from_disk()
        elif backend != "memory":
            raise ValueError(f"Unknown backend: {backend!r}. Only 'memory' is supported.")

    def create_index(self, dimension, shards=1):
        pass  # memory backend needs no index setup

    def delete_index(self, shard=None):
        with self._lock:
            if self.backend == "memory":
                self._docs = [d for d in self._docs if d.shard != shard] if shard else []
                self._rebuild_bm25()
                self._save_to_disk()

    def upsert(self, doc_id, vector, text, source, shard, metadata=None):
        self.upsert_batch([{"id":doc_id,"vector":vector,"text":text,"source":source,"shard":shard,"metadata":metadata or {}}])

    def upsert_batch(self, documents):
        if not documents: return 0
        with self._lock:
            if self.backend == "memory": return self._mem_upsert(documents)
        return 0

    def search(self, query_vector, top_k=10, shard_filter=None):
        with self._lock:
            if self.backend == "memory": return self._mem_search(query_vector, top_k, shard_filter)
        return []

    def bm25_search(self, query_text, top_k=10, shard_filter=None):
        with self._lock:
            if self.backend == "memory": return self._mem_bm25(query_text, top_k, shard_filter)
        return []

    def stats(self):
        with self._lock:
            if self.backend == "memory":
                shards = {}
                for d in self._docs:
                    s = shards.setdefault(d.shard, {"doc_count":0,"last_indexed":None})
                    s["doc_count"] += 1
                    ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(d.indexed_at))
                    if s["last_indexed"] is None or ts > s["last_indexed"]: s["last_indexed"] = ts
                return {"backend":"memory","total_docs":len(self._docs),"shards":shards}
        return {}

    def _mem_upsert(self, documents):
        ids = {d["id"] for d in documents}
        self._docs = [doc for doc in self._docs if doc.doc_id not in ids]
        for d in documents:
            self._docs.append(_Doc(doc_id=d["id"], vector=np.array(d["vector"],dtype=np.float32),
                                   text=d.get("text",""), source=d.get("source",""),
                                   shard=d.get("shard","default"), metadata=d.get("metadata",{})))
        self._rebuild_bm25()
        self._save_to_disk()
        return len(documents)

    def _mem_search(self, query_vector, top_k, shard_filter):
        docs = [d for d in self._docs if not shard_filter or d.shard == shard_filter]
        if not docs: return []
        q = np.array(query_vector, dtype=np.float32)
        matrix = np.stack([d.vector for d in docs])
        scores = matrix @ q / (np.linalg.norm(matrix,axis=1) * np.linalg.norm(q) + 1e-9)
        top_idx = np.argsort(-scores)[:top_k]
        return [{"id":docs[i].doc_id,"score":float(scores[i]),"text":docs[i].text,
                 "source":docs[i].source,"metadata":docs[i].metadata} for i in top_idx]

    def _mem_bm25(self, query_text, top_k, shard_filter):
        docs = [d for d in self._docs if not shard_filter or d.shard == shard_filter]
        if not docs: return []
        try:
            from rank_bm25 import BM25Okapi
            import numpy as np
        except ImportError: return []
        tokens = query_text.lower().split()
        bm25 = BM25Okapi([d.text.lower().split() for d in docs])
        scores = bm25.get_scores(tokens)
        top_idx = np.argsort(-scores)[:top_k]
        return [{"id":docs[i].doc_id,"score":float(scores[i]),"text":docs[i].text,
                 "source":docs[i].source,"metadata":docs[i].metadata}
                for i in top_idx if scores[i] > 0]

    def _rebuild_bm25(self):
        try:
            from rank_bm25 import BM25Okapi
            if self._docs:
                self._bm25_index = BM25Okapi([d.text.lower().split() for d in self._docs])
        except ImportError: pass

    def _save_to_disk(self):
        try:
            with open(self._store_path,"wb") as f: pickle.dump(self._docs,f,protocol=pickle.HIGHEST_PROTOCOL)
        except Exception as e: logger.warning("Cannot persist store: %s",e)

    def _load_from_disk(self):
        if os.path.exists(self._store_path):
            try:
                with open(self._store_path,"rb") as f: self._docs = pickle.load(f)
                self._rebuild_bm25()
                logger.info("Loaded %d docs", len(self._docs))
            except Exception as e:
                logger.warning("Cannot load store: %s", e); self._docs = []

