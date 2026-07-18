"""
rag/corpus/loinc_loader.py — Indexes LOINC observation codes.

PURPOSE
-------
The observations table stores lab results and vitals as LOINC codes (e.g. 4548-4).
This module indexes each LOINC code with its clinical name, measurement units,
and reference range so the RAG pipeline can answer questions about lab values.

WHAT IS LOINC?
--------------
LOINC (Logical Observation Identifiers Names and Codes) is maintained by the
Regenstrief Institute and is the universal standard for identifying laboratory
and clinical observations.

Each LOINC code identifies a specific measurement:
  4548-4   →  Hemoglobin A1c/Hemoglobin.total in Blood (%)
               Reference range: <5.7 normal, 5.7-6.4 prediabetes, ≥6.5 diabetes
  8480-6   →  Systolic Blood Pressure (mm[Hg])
               Reference range: 90–120
  6690-2   →  Leukocytes [WBC] in Blood (10^3/uL)
               Reference range: 4.5–11.0

LOINC is used in HL7 FHIR, clinical laboratory systems, and EHRs worldwide to
ensure that "blood pressure" in one system means exactly the same thing in another.

BUILT-IN LOINC TABLE
---------------------
This module includes a built-in dictionary of 16 common LOINC codes covering
vital signs, CBC (complete blood count), and metabolic panel values.
These 16 codes are ALWAYS indexed regardless of what is in DynamoDB —
no external API or file download required.

The full LOINC table (100,000+ codes) can be indexed by downloading the CSV
from loinc.org (free registration) and passing loinc_csv_path.

WHAT IS INDEXED
---------------
"LOINC 4548-4: Hemoglobin A1c. Unit: %. Reference range: <5.7 normal;
 5.7-6.4 prediabetes; ≥6.5 diabetes. Category: CHEM."

CLASS
-----
LOINCLoader(embedder, vector_store, loinc_csv_path=None)

    load_from_observations_table(table_name) -> int
        Scans observations table + adds built-in codes → indexes all.

    load_from_csv(csv_path) -> int
        Load and index the full LOINC table from a local CSV download.

    _index_codes(code_map: dict) -> int   Batch embed + upsert all codes.
    _code_to_text(code, name, units, ref, cls) -> str   Serialise to text.

BUILTIN constant
    16-entry dict mapping common LOINC codes to (name, units, reference_range, class).
"""

import csv, logging, os
logger = logging.getLogger(__name__)
SHARD = "loinc"

BUILTIN = {
    "8302-2": ("Body Height","cm","—","ANTHRO"),
    "29463-7": ("Body Weight","kg","—","ANTHRO"),
    "39156-5": ("BMI","kg/m2","18.5–24.9 normal","ANTHRO"),
    "8480-6": ("Systolic Blood Pressure","mm[Hg]","90–120","COAG"),
    "8462-4": ("Diastolic Blood Pressure","mm[Hg]","60–80","COAG"),
    "8867-4": ("Heart Rate","/min","60–100","COAG"),
    "2093-3": ("Cholesterol","mg/dL","<200 desirable","CHEM"),
    "2571-8": ("Triglycerides","mg/dL","<150 normal","CHEM"),
    "18262-6": ("LDL Cholesterol","mg/dL","<100 optimal","CHEM"),
    "2085-9": ("HDL Cholesterol","mg/dL",">60 protective","CHEM"),
    "4548-4": ("Hemoglobin A1c","%","<5.7 normal; 5.7-6.4 prediabetes; ≥6.5 diabetes","CHEM"),
    "33914-3": ("eGFR","mL/min/1.73m2","≥60 normal","CHEM"),
    "2160-0": ("Creatinine","mg/dL","0.7–1.2 male; 0.5–1.0 female","CHEM"),
    "6690-2": ("WBC","10^3/uL","4.5–11.0","CBC"),
    "718-7": ("Hemoglobin","g/dL","13.5–17.5 male; 12.0–15.5 female","CBC"),
    "777-3": ("Platelets","10^3/uL","150–400","CBC"),
}

class LOINCLoader:
    def __init__(self, embedder, vector_store, loinc_csv_path=None):
        """Initialise with Embedder, VectorStore, and optional path to a LOINC CSV download (loinc.org)."""
        self.embedder = embedder; self.store = vector_store
        self._csv = loinc_csv_path or os.getenv("LOINC_CSV_PATH","")

    def load_from_observations_table(self, table_name="observations"):
        """Scan observations table for LOINC codes, merge with built-in table, index all. Returns count."""
        import boto3
        try:
            db = boto3.resource("dynamodb", region_name=os.getenv("AWS_REGION","us-east-1"))
            resp = db.Table(table_name).scan(ProjectionExpression="CODE, DESCRIPTION, UNITS")
            code_map = {
            str(i.get("code") or i.get("CODE") or ""): str(i.get("description") or i.get("DESCRIPTION") or "")
            for i in resp.get("Items", [])
            if i.get("code") or i.get("CODE")
        }
        except Exception: code_map = {}
        for code in BUILTIN: code_map.setdefault(code, "")
        return self._index_codes(code_map)

    def load_from_csv(self, csv_path):
        """Load and index the full LOINC table from a locally downloaded CSV (loinc.org). Returns count."""
        code_map = {}
        with open(csv_path, newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                code, name = row.get("LOINC_NUM","").strip(), row.get("LONG_COMMON_NAME","").strip()
                if code and name: code_map[code] = name
        return self._index_codes(code_map)

    def _index_codes(self, code_map):
        """Batch embed and upsert all LOINC code descriptions. Returns document count."""
        docs, texts = [], []
        for code, fallback in code_map.items():
            b = BUILTIN.get(code)
            name, units, ref, cls = b if b else (fallback or code, "", "", "")
            text = f"LOINC {code}: {name}."
            if units: text += f" Unit: {units}."
            if ref and ref != "—": text += f" Reference range: {ref}."
            if cls: text += f" Category: {cls}."
            texts.append(text)
            docs.append({"id":f"loinc-{code}","text":text,"source":f"LOINC {code}","shard":SHARD,
                         "metadata":{"loinc_code":code,"name":name,"units":units,"reference_range":ref}})
        if not docs: return 0
        vectors = self.embedder.embed_batch(texts)
        for i, doc in enumerate(docs): doc["vector"] = vectors[i]
        return self.store.upsert_batch(docs)
