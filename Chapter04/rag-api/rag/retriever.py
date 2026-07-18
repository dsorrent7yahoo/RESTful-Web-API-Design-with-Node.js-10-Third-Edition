"""
rag/retriever.py — Hybrid BM25 + dense retrieval with Reciprocal Rank Fusion.

PURPOSE
-------
Given a clinical question, find the most relevant passages from the vector store.
This module combines two complementary search strategies and merges their rankings
into a single, higher-quality result list.

WHY HYBRID RETRIEVAL?
---------------------
Dense search (cosine similarity)  is great at semantic matching: it finds
"Hemoglobin A1c" even if the query says "HbA1c blood sugar test" because both
map to similar vector positions.

Keyword search (BM25) is great at exact matching: it reliably surfaces
"Warfarin Sodium 5 MG Oral Tablet" when the user types that exact string,
which a dense model might rank lower because the embedding collapses synonyms.

Combining both via RRF consistently outperforms either alone on biomedical
retrieval benchmarks (BEIR-Medical).

WHAT IS RRF?
------------
Reciprocal Rank Fusion (RRF) merges two ranked lists without needing to normalise
their scores (which are on incompatible scales):

    fused_score(doc) = Σ  1 / (k + rank_in_list_i)

where k=60 dampens the influence of very-high-ranked items.
The alpha parameter controls the weight of dense vs BM25:
  alpha=1.0  → pure dense retrieval
  alpha=0.0  → pure BM25
  alpha=0.6  → 60% dense + 40% BM25 (default, recommended for clinical text)

WHAT IS PACE-RAG?
-----------------
PACE-RAG (Patient-Aware Contextual and Evidence-Constrained RAG, arXiv:2603.17356)
augments the search query with a summary of the patient's current clinical context
(active medications, diagnosed conditions, recent lab observations) before embedding.
This steers retrieval toward passages relevant to THIS specific patient rather than
the general population.

CLASS
-----
HybridRetriever(embedder, vector_store, alpha=0.6)
    retrieve(query, top_k, shard_filter, patient_context) -> list[dict]
        Main retrieval method.  Embeds the query, performs both dense and BM25 search,
        fuses rankings with RRF, and returns the top-k passages.
        patient_context: optional dict with active_meds, conditions, observations
                         (enables PACE-RAG query augmentation).

    extract_patient_features(context: dict) -> str
        Converts patient EHR dict into a text feature summary for query augmentation.
        Implements PACE-RAG Section 3.1 patient feature extraction.

    _rrf(dense_hits, bm25_hits, k=60) -> list[dict]
        Internal RRF merge.  Returns list sorted by fused score descending.
"""

import logging
logger = logging.getLogger(__name__)

class HybridRetriever:
    """BM25 + dense retrieval with Reciprocal Rank Fusion (alpha=0.6 default)."""
    def __init__(self, embedder, vector_store, alpha=0.6):
        self.embedder = embedder
        self.store = vector_store
        self.alpha = max(0.0, min(1.0, alpha))

    def retrieve(self, query, top_k=5, shard_filter=None, patient_context=None):
        augmented = query
        if patient_context:
            features = self.extract_patient_features(patient_context)
            if features:
                augmented = f"{query} [Patient context: {features}]"
        fetch_k = max(top_k * 3, 15)
        dense_hits, bm25_hits = [], []
        if self.alpha > 0:
            vec = self.embedder.embed(augmented)
            dense_hits = self.store.search(vec, top_k=fetch_k, shard_filter=shard_filter)
        if self.alpha < 1:
            bm25_hits = self.store.bm25_search(augmented, top_k=fetch_k, shard_filter=shard_filter)
        if not dense_hits and not bm25_hits: return []
        return self._rrf(dense_hits, bm25_hits)[:top_k]

    def extract_patient_features(self, ctx):
        parts = []
        meds = ctx.get("active_meds", [])
        if meds:
            parts.append("active medications: " + ", ".join(
                m.get("DESCRIPTION", m.get("description","?")) for m in meds[:5]))
        conds = ctx.get("conditions", [])
        if conds:
            parts.append("conditions: " + ", ".join(
                c.get("DESCRIPTION", c.get("description","?")) for c in conds[:5]))
        obs = ctx.get("observations", [])
        if obs:
            obs_parts = [f"{o.get('DESCRIPTION','')}={o.get('VALUE','')}{o.get('UNITS','')}"
                         for o in obs[:3] if o.get("DESCRIPTION") and o.get("VALUE")]
            if obs_parts: parts.append("observations: " + "; ".join(obs_parts))
        return ". ".join(parts)

    def _rrf(self, dense_hits, bm25_hits, k=60):
        scores, doc_map = {}, {}
        for rank, hit in enumerate(dense_hits, 1):
            did = hit["id"]
            scores[did] = scores.get(did, 0.0) + self.alpha * (1.0 / (k + rank))
            doc_map[did] = hit
        w = 1.0 - self.alpha
        for rank, hit in enumerate(bm25_hits, 1):
            did = hit["id"]
            scores[did] = scores.get(did, 0.0) + w * (1.0 / (k + rank))
            if did not in doc_map: doc_map[did] = hit
        ranked = sorted(scores.items(), key=lambda x: x[1], reverse=True)
        return [{**doc_map[did], "score": round(s, 6)} for did, s in ranked]
