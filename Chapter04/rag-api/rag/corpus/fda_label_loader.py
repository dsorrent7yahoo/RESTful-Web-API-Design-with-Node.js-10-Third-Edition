"""
rag/corpus/fda_label_loader.py — Fetches and indexes FDA drug labels.

PURPOSE
-------
Drug interaction questions (the copilot mode) need more context than patient
records alone.  FDA drug labels contain authoritative clinical information:
indications, warnings, drug interactions, dosage guidance, contraindications.
This module fetches those labels from the OpenFDA REST API and indexes them.

WHAT IS THE FDA?
----------------
The FDA (Food and Drug Administration) is the US federal agency that regulates
prescription and over-the-counter drugs.  Before any drug can be sold in the US,
the manufacturer submits a structured drug label (also called a package insert)
that the FDA reviews and approves.

WHAT IS OpenFDA?
----------------
OpenFDA (api.fda.gov) is a free public REST API that exposes FDA data including
drug labels, adverse event reports, and recall notices.
No API key is required for up to 1,000 requests/day.
Register at open.fda.gov for 120,000 requests/day.

Label endpoint:   https://api.fda.gov/drug/label.json
Example query:    ?search=openfda.generic_name:"Metformin"&limit=1

WHAT IS INDEXED
---------------
For each unique drug found in the medications DynamoDB table, the loader fetches
the FDA label and indexes these 8 sections (as separate text chunks):
  indications_and_usage       What the drug treats
  warnings                    Safety warnings
  drug_interactions           Other drugs that interact with it
  dosage_and_administration   How much to take and how
  contraindications           Who should NOT take it
  adverse_reactions           Known side effects
  precautions                 Special population warnings
  boxed_warning               The strongest FDA warning (if present)

Each section is split into 400-word overlapping chunks so long label sections
fit within the LLM context window.

CLASS
-----
FDALabelLoader(embedder, vector_store, api_key=None)

    load_from_medications_table(table_name) -> int
        Extracts unique drug names from DynamoDB, fetches FDA labels, indexes.
        Returns total sections indexed.

    load_by_drug_name(drug_name) -> int
        Fetch and index the label for one drug name.

    _fetch(drug_name) -> dict | None    GET api.fda.gov/drug/label.json
    _index(drug_name, label) -> int     Chunk + embed + upsert each label section
    _chunk(text, size, overlap) -> list[str]  Sliding-window word chunker
"""

import logging, os, time, requests
logger = logging.getLogger(__name__)
FDA_BASE = "https://api.fda.gov/drug/label.json"
SHARD = "fda-labels"
SECTIONS = ["indications_and_usage","warnings","drug_interactions",
            "dosage_and_administration","contraindications","adverse_reactions",
            "precautions","boxed_warning"]

class FDALabelLoader:
    def __init__(self, embedder, vector_store, api_key=None):
        self.embedder = embedder; self.store = vector_store
        self._api_key = api_key or os.getenv("FDA_API_KEY","")
        self._session = requests.Session()
        self._session.headers["User-Agent"] = "healthcare-rag/1.0"

    def load_from_medications_table(self, table_name="medications"):
        """Scan DynamoDB, extract unique drug names, fetch FDA labels, index all sections."""
        """Scan DynamoDB table, extract unique drug names, fetch FDA labels, index all sections."""
        import boto3
        db = boto3.resource("dynamodb", region_name=os.getenv("AWS_REGION","us-east-1"))
        resp = db.Table(table_name).scan()  # No ProjectionExpression — fields are lowercase
        drug_names = list({
            (item.get("description") or item.get("DESCRIPTION") or "").split(" ")[0]
            for item in resp.get("Items",[])
            if item.get("description") or item.get("DESCRIPTION")
        })
        drug_names = [n for n in drug_names if n and len(n) > 2 and n != "Medication"]
        logger.info("Fetching FDA labels for %d drugs", len(drug_names))
        total = 0
        for name in drug_names:
            try: total += self.load_by_drug_name(name); time.sleep(0.15)
            except Exception as e: logger.warning("FDA failed for %r: %s", name, e)
        return total

    def load_by_drug_name(self, drug_name):
        """Fetch FDA label for one drug name and index all label sections. Returns section count."""
        """Fetch FDA label for one drug name and index all 8 label sections. Returns section count."""
        label = self._fetch(drug_name)
        return self._index(drug_name, label) if label else 0

    def _fetch(self, name):
        """GET api.fda.gov/drug/label.json. Tries generic name, falls back to brand name."""
        """GET api.fda.gov/drug/label.json for one drug name. Tries generic name then brand name fallback."""
        params = {"search": f'openfda.generic_name:"{name}"', "limit": 1}
        if self._api_key: params["api_key"] = self._api_key
        resp = self._session.get(FDA_BASE, params=params, timeout=15)
        if resp.status_code == 404:
            params["search"] = f'openfda.brand_name:"{name}"'
            resp = self._session.get(FDA_BASE, params=params, timeout=15)
        if not resp.ok: return None
        results = resp.json().get("results",[])
        return results[0] if results else None

    def _index(self, drug_name, label):
        """Chunk each label section and embed+upsert into the fda-labels shard."""
        """Chunk each label section and embed+upsert into the fda-labels vector shard."""
        openfda = label.get("openfda",{})
        brand = (openfda.get("brand_name") or [""])[0]
        generic = (openfda.get("generic_name") or [""])[0]
        rxcui = (openfda.get("rxcui") or [""])[0]
        display = brand or generic or drug_name
        chunks = []
        for sec in SECTIONS:
            raw = label.get(sec)
            if not raw: continue
            text = raw[0] if isinstance(raw,list) else raw
            for i, chunk in enumerate(self._chunk(text)):
                slug = drug_name.lower().replace(" ","_")
                chunks.append({"id":f"fda-{rxcui or slug}-{sec}-{i}",
                               "text":f"FDA Label — {display} | {sec.replace('_',' ').title()}:\n{chunk}",
                               "source":f"FDA Drug Label — {display}","shard":SHARD,
                               "metadata":{"drug_name":display,"rxcui":rxcui,"section":sec}})
        if not chunks: return 0
        texts = [c["text"] for c in chunks]
        vectors = self.embedder.embed_batch(texts)
        return self.store.upsert_batch([{**c,"vector":vectors[i]} for i,c in enumerate(chunks)])

    def _chunk(self, text, size=400, overlap=50):
        """Sliding-window word-level chunker preserving sentence context."""
        """Split a long text string into overlapping word-level windows."""
        words = text.split()
        if len(words) <= size: return [text]
        chunks = []; start = 0
        while start < len(words):
            chunks.append(" ".join(words[start:start+size])); start += size-overlap
        return chunks
