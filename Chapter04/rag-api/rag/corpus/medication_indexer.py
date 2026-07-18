"""
rag/corpus/medication_indexer.py — Indexes the DynamoDB medications table.

PURPOSE
-------
Reads medication records from DynamoDB, converts each one into a richly-worded
clinical sentence, embeds it with ClinicalBERT, and stores the vector in the
vector store under the "medications" shard.

WHAT IS A MEDICATION RECORD?
-----------------------------
Each record comes from the Synthea Coherent Dataset (coherent-11-07-2022/csv/).
Synthea is an open-source synthetic patient generator that produces realistic
(but entirely fictional) EHR data following FHIR R4 standards.

Key fields in each record:
  patient       UUID of the synthetic patient
  description   Drug name and form (e.g. "24 HR Metformin hydrochloride 500 MG")
  code          RxNorm code (numerical drug identifier from NIH)
  start / stop  Prescription start and end dates (ISO 8601)
  reasonDescription  Why the drug was prescribed (e.g. "Diabetes")
  payer         Insurance payer name
  totalCost     Total dispensing cost in USD

WHAT IS RxNorm?
---------------
RxNorm is a standardized nomenclature for clinical drugs maintained by the NLM
(National Library of Medicine).  It provides a unique code for every drug + dose +
form combination, allowing different systems to exchange drug information unambiguously.
Example: RxNorm 860975 = "24 HR Metformin hydrochloride 500 MG Extended Release"

INDEXED TEXT FORMAT
--------------------
Each record is serialised into a sentence like:
  "Patient abc-123 was prescribed 24 HR Metformin hydrochloride 500 MG
   (RxNorm code: 860975) from 2010-03-01 to ongoing. Reason: Diabetes.
   Payer: Anthem. Total cost: $45."

CLASS
-----
MedicationIndexer(embedder, vector_store, table_name="medications")
"""

import logging, os, boto3
from boto3.dynamodb.conditions import Attr
logger = logging.getLogger(__name__)
SHARD = "medications"

def _f(record, *keys):
    """Resolve a field from a record, trying both lower and upper case variants."""
    for k in keys:
        v = record.get(k) or record.get(k.upper()) or record.get(k.lower())
        if v: return str(v).strip()
    return ""

class MedicationIndexer:
    def __init__(self, embedder, vector_store, table_name="medications"):
        """Initialise with an Embedder, VectorStore, and the DynamoDB table name."""
        self.embedder = embedder; self.store = vector_store; self.table_name = table_name
        self._db = boto3.resource("dynamodb", region_name=os.getenv("AWS_REGION","us-east-1"))

    def index_all(self, batch_size=100, limit=500, job_ref=None):
        """Full DynamoDB scan, embed, upsert. limit=0 indexes all records; job_ref receives live progress."""
        table = self._db.Table(self.table_name)
        total = 0; scan_kwargs = {}
        if job_ref: job_ref["status"] = "running"
        logger.info("Indexing from %s (limit=%s)", self.table_name, limit or "ALL")
        while True:
            kwargs = dict(scan_kwargs)
            if limit:
                kwargs["Limit"] = min(batch_size, max(1, limit - total))
            resp = table.scan(**kwargs)
            items = resp.get("Items", [])
            if not items: break
            count = self._index_batch(items)
            total += count
            if job_ref: job_ref["documents_done"] = total
            logger.info("Batch done +%d  total=%d", count, total)
            if limit and total >= limit:
                logger.info("Reached limit %d", limit); break
            last = resp.get("LastEvaluatedKey")
            if not last: break
            scan_kwargs["ExclusiveStartKey"] = last
        logger.info("Done — %d docs indexed", total)
        return total

    def index_by_patient(self, patient_id, job_ref=None):
        """Index only medication records for one patient UUID. Uses DynamoDB FilterExpression."""
        resp = self._db.Table(self.table_name).scan(
            FilterExpression=Attr("patient").eq(patient_id) | Attr("PATIENT").eq(patient_id))
        items = resp.get("Items", [])
        count = self._index_batch(items) if items else 0
        if job_ref: job_ref["documents_done"] = count
        return count

    def _index_batch(self, items):
        """Embed one batch of DynamoDB items and upsert into the medications shard."""
        texts = [self._to_text(i) for i in items]
        vectors = self.embedder.embed_batch(texts)
        docs = [{"id": f"med-{_f(item,'id','Id','ID') or str(idx)}",
                 "vector": vectors[idx], "text": texts[idx],
                 "source": f"DynamoDB/{self.table_name}", "shard": SHARD,
                 "metadata": self._to_meta(item)}
                for idx, item in enumerate(items)]
        return self.store.upsert_batch(docs)

    def _to_text(self, r):
        """Serialise one medication record to a readable clinical sentence for embedding."""
        patient = _f(r, "patient", "PATIENT") or "unknown patient"
        desc    = _f(r, "description", "DESCRIPTION") or "unknown medication"
        code    = _f(r, "code", "CODE")
        start   = _f(r, "start", "START")
        stop    = _f(r, "stop", "STOP") or "ongoing"
        reason  = _f(r, "reasonDescription", "REASONDESCRIPTION")
        payer   = _f(r, "payer", "PAYER")
        cost    = _f(r, "totalCost", "TOTALCOST")
        parts = [
            f"Patient {patient} was prescribed {desc}",
            f"(RxNorm code: {code})" if code else "",
            f"from {start} to {stop}.",
            f"Reason: {reason}." if reason else "",
            f"Payer: {payer}." if payer else "",
            f"Total cost: ${cost}." if cost else "",
        ]
        return " ".join(p for p in parts if p).strip()

    def _to_meta(self, r):
        """Extract filterable metadata: patient, code, description, start, stop, payer."""
        return {
            "patient":     _f(r, "patient", "PATIENT"),
            "code":        _f(r, "code", "CODE"),
            "description": _f(r, "description", "DESCRIPTION"),
            "start":       _f(r, "start", "START"),
            "stop":        _f(r, "stop", "STOP"),
            "payer":       _f(r, "payer", "PAYER"),
        }
