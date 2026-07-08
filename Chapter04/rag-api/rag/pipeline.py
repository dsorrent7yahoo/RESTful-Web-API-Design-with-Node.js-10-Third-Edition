"""
rag/pipeline.py — End-to-end RAG orchestration pipeline.

PURPOSE
-------
This is the "brain" of the RAG system.  It coordinates all the components:
  1. Loads patient EHR context from DynamoDB (optional, for PACE-RAG)
  2. Retrieves relevant passages via the HybridRetriever
  3. Generates a grounded answer via the Generator
  4. Validates the answer for potential hallucinations

WHAT IS RAG?
------------
Retrieval-Augmented Generation (RAG) is an AI architecture that improves LLM
accuracy on knowledge-intensive tasks by:
  1. Retrieving factual context from a curated corpus (e.g. FDA drug labels,
     patient medication records, LOINC reference ranges)
  2. Injecting those facts into the LLM prompt as "context passages"
  3. Instructing the LLM to answer ONLY from the provided context

This prevents hallucination of drug names, dosages, and clinical guidelines —
the LLM cannot invent facts that are not in the retrieved passages.

Research basis: Lewis et al. 2020 "Retrieval-Augmented Generation for
Knowledge-Intensive NLP Tasks" (NeurIPS 2020, arXiv:2005.11401).

HALLUCINATION GUARD
--------------------
After generation, _validate() scans the answer for capitalised multi-word terms
(potential drug names like "Lisinopril", "Metformin") and checks whether each
appears in the retrieved passages.  Terms not found in any passage are flagged
as potential hallucinations in the hallucination_flags response field.

PATIENT CONTEXT LOADING (PACE-RAG)
-----------------------------------
When query() is called with a patient_id, _load_patient() fetches the patient's
current clinical picture from three DynamoDB tables:
  medications   — active prescriptions (STOP date is null)
  conditions    — diagnosed conditions (SNOMED codes)
  observations  — recent lab results (LOINC codes)
This context is passed to the HybridRetriever for PACE-RAG query augmentation.

CLASS
-----
RAGPipeline(embedder, retriever, generator)
    query(question, patient_id, mode, top_k, shard_filter) -> dict
        Full RAG query.  Returns {answer, sources, mode, patient_id,
        tokens, latency_ms, hallucination_flags}.

    _load_patient(patient_id: str) -> dict
        DynamoDB scan for active_meds, conditions, observations.

    _validate(answer: str, passages: list) -> (str, list[str])
        Hallucination guard.  Returns (answer_unchanged, flagged_terms).

    _get_db()
        Lazy boto3 DynamoDB resource initialiser.
"""

import logging, os, re, time
import boto3
from botocore.exceptions import ClientError
logger = logging.getLogger(__name__)

class RAGPipeline:
    def __init__(self, embedder, retriever, generator):
        self.embedder = embedder
        self.retriever = retriever
        self.generator = generator
        self._db = None

    def query(self, question, patient_id=None, mode="standard", top_k=5, shard_filter=None):
        t0 = time.time()
        patient_context = None
        if patient_id:
            try: patient_context = self._load_patient(patient_id)
            except Exception as e: logger.warning("Patient context error: %s", e)
        passages = self.retriever.retrieve(question, top_k=top_k,
                                           shard_filter=shard_filter,
                                           patient_context=patient_context)
        gen = self.generator.generate(question, passages, mode=mode)
        answer, flags = self._validate(gen["answer"], passages)
        if flags: logger.warning("Hallucination flags: %s", flags)
        return {
            "answer": answer,
            "sources": [{"id":p.get("id",""),"text":p.get("text","")[:300],
                         "source":p.get("source",""),"score":round(p.get("score",0.0),4)}
                        for p in passages],
            "mode": mode, "patient_id": patient_id,
            "tokens": gen.get("tokens",{"prompt":0,"completion":0,"total":0}),
            "latency_ms": int((time.time()-t0)*1000),
            "hallucination_flags": flags,
        }

    def _load_patient(self, patient_id):
        db = self._get_db()
        ctx = {"patient_id": patient_id}
        for tname, key in [("medications","active_meds"),("conditions","conditions"),
                           ("observations","observations")]:
            try:
                resp = db.Table(tname).scan(
                    FilterExpression=boto3.dynamodb.conditions.Attr("PATIENT").eq(patient_id),
                    Limit=20)
                items = resp.get("Items",[])
                ctx[key] = ([i for i in items if not i.get("STOP")][:10]
                            if tname=="medications" else items[:10])
            except ClientError: ctx[key] = []
        return ctx

    def _validate(self, answer, passages):
        if not passages: return answer, []
        corpus = " ".join(p.get("text","") for p in passages).lower()
        flagged = [t for t in set(re.findall(r"\b([A-Z][a-z]{5,}(?:\s+\d+\s*MG)?)\b", answer))
                   if t.lower() not in corpus]
        return answer, flagged

    def _get_db(self):
        if self._db is None:
            self._db = boto3.resource("dynamodb", region_name=os.getenv("AWS_REGION","us-east-1"))
        return self._db
