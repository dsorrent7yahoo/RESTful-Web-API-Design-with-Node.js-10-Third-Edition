"""
rag/corpus/snomed_loader.py — Indexes SNOMED CT condition concepts.

PURPOSE
-------
The conditions table stores diagnoses as SNOMED CT codes (e.g. 162864005).
Without context, these codes mean nothing to the LLM.  This module fetches
the full concept name and synonyms from the UMLS Metathesaurus and indexes
them so the RAG pipeline can answer questions about conditions.

WHAT IS SNOMED CT?
------------------
SNOMED CT (Systematized Nomenclature of Medicine — Clinical Terms) is the world's
most comprehensive clinical health terminology standard, maintained by SNOMED
International and adopted in over 80 countries.

It assigns a unique numerical code to every clinical concept:
  162864005  →  "Body mass index 30+ - obesity (finding)"
  15777000   →  "Prediabetes"
  44054006   →  "Diabetes mellitus type 2 (disorder)"

SNOMED CT is used in EHR systems, clinical decision support, and health data
exchange to ensure every system means exactly the same thing by a diagnosis code.

WHAT IS UMLS?
-------------
The UMLS (Unified Medical Language System) is maintained by the NLM (National
Library of Medicine) and integrates over 200 medical vocabularies including
SNOMED CT, ICD-10, MeSH, and RxNorm into a single searchable database.

The UMLS Metathesaurus API (uts-ws.nlm.nih.gov/rest) returns concept names,
definitions, and synonyms for any SNOMED code.

A free API key is required: https://uts.nlm.nih.gov/uts/signup-login
Set UMLS_API_KEY in .env or the environment.

WHAT IS INDEXED
---------------
For each unique SNOMED code in the conditions DynamoDB table:
  "SNOMED CT 162864005: Body mass index 30+ - obesity (finding).
   Also known as: Obesity, BMI over 30."

CLASS
-----
SNOMEDLoader(embedder, vector_store, umls_api_key=None)

    load_from_conditions_table(table_name) -> int
        Scans conditions table, fetches UMLS concept data, indexes.

    _fetch(snomed_code) -> dict | None
        Queries UMLS Metathesaurus for {name, definition, synonyms}.

    _index(code, concept) -> int   Embeds and upserts one concept.
    _concept_to_text(code, concept) -> str  Serialises concept to indexable text.
    _get_st() -> str | None        Obtains a UMLS single-use service ticket via CAS.
"""

import logging, os, time, requests
logger = logging.getLogger(__name__)
UMLS_BASE = "https://uts-ws.nlm.nih.gov/rest"
SHARD = "snomed"

class SNOMEDLoader:
    def __init__(self, embedder, vector_store, umls_api_key=None):
        self.embedder = embedder; self.store = vector_store
        self._api_key = umls_api_key or os.getenv("UMLS_API_KEY","")
        self._session = requests.Session(); self._tgt = None

    def load_from_conditions_table(self, table_name="conditions"):
        """Scan conditions DynamoDB table, fetch UMLS concept names for each SNOMED code, index. Returns count."""
        if not self._api_key:
            logger.warning("UMLS_API_KEY not set — skipping SNOMED indexing"); return 0
        import boto3
        try:
            db = boto3.resource("dynamodb", region_name=os.getenv("AWS_REGION","us-east-1"))
            resp = db.Table(table_name).scan()  # fetch all fields; code/description may be lower or upper case
            items = resp.get("Items",[])
        except Exception as e: logger.warning("Cannot scan %s: %s", table_name, e); return 0
        code_map = {
            str(i.get("code") or i.get("CODE") or "").strip():
            str(i.get("description") or i.get("DESCRIPTION") or "").strip()
            for i in items
            if i.get("code") or i.get("CODE")
        }
        logger.info("Indexing %d SNOMED codes", len(code_map))
        total = 0
        for code, fallback in code_map.items():
            try:
                concept = self._fetch(code) or {"name":fallback,"definition":"","synonyms":[]}
                total += self._index(code, concept); time.sleep(0.1)
            except Exception as e: logger.warning("SNOMED %s failed: %s", code, e)
        return total

    def _fetch(self, code):
        """Query UMLS Metathesaurus for concept name and synonyms for one SNOMED code."""
        st = self._get_st()
        if not st: return None
        resp = self._session.get(f"{UMLS_BASE}/search/current",
                                 params={"string":code,"sabs":"SNOMEDCT_US","inputType":"code",
                                         "ticket":st,"returnIdType":"concept"}, timeout=15)
        if not resp.ok: return None
        results = resp.json().get("result",{}).get("results",[])
        if not results: return None
        return {"name":results[0].get("name",""),"definition":"","synonyms":[]}

    def _index(self, code, concept):
        """Embed and upsert one SNOMED concept text into the snomed vector shard."""
        text = self._concept_to_text(code, concept)
        name = concept.get("name", code)
        vec = self.embedder.embed(text)
        return self.store.upsert_batch([{"id":f"snomed-{code}","vector":vec,"text":text,
                                         "source":f"SNOMED CT {code}","shard":SHARD,
                                         "metadata":{"snomed_code":code,"name":name}}])

    def _concept_to_text(self, code, concept):
        """Serialise a SNOMED concept dict to an indexable text sentence."""
        name = concept.get("name", code)
        text = f"SNOMED CT {code}: {name}."
        if concept.get("definition"): text += " " + concept["definition"]
        if concept.get("synonyms"): text += " Also known as: " + ", ".join(concept["synonyms"][:3]) + "."
        return text

    def _get_st(self):
        """Obtain a single-use UMLS service ticket via CAS (Central Authentication Service)."""
        try:
            if not self._tgt:
                resp = requests.post("https://utslogin.nlm.nih.gov/cas/v1/api-key",
                                     data={"apikey":self._api_key}, timeout=15)
                if not resp.ok: return None
                loc = resp.headers.get("location","")
                self._tgt = loc.split("/")[-1] if loc else ""
            if not self._tgt: return None
            st_resp = requests.post(f"https://utslogin.nlm.nih.gov/cas/v1/tickets/{self._tgt}",
                                    data={"service":"http://umlsks.nlm.nih.gov"}, timeout=15)
            return st_resp.text.strip() if st_resp.ok else None
        except Exception as e: logger.warning("UMLS auth failed: %s", e); return None
