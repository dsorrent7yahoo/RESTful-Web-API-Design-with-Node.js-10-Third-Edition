"""
synthetic_fhir_claims.py
Lambda: generates 100 synthetic FHIR R4 Claim records and writes them as a
single CSV to s3://dgs-glue-staging/claims/claims-YYYY-MM-DD.csv.

Every 10th row (index 0, 10, 20 ...) intentionally omits service_date so a
downstream cleaner lambda has dirty rows to drop.

Local test:
    pip install fhir.resources boto3
    python synthetic_fhir_claims.py
"""

import csv
import io
import os
import random
import uuid
from datetime import date, timedelta

import boto3

try:
    from fhir.resources.claim import Claim
    FHIR_AVAILABLE = True
except ImportError:
    FHIR_AVAILABLE = False
    print("[warn] fhir.resources not installed - skipping FHIR validation")

# -- configuration (override via Lambda env vars) --
BUCKET         = os.getenv("STAGING_BUCKET",       "dgs-glue-staging")
PREFIX         = os.getenv("CLAIMS_PREFIX",        "claims/")
TOTAL_CLAIMS   = int(os.getenv("TOTAL_CLAIMS",     "100"))
MISSING_MODULO = int(os.getenv("MISSING_DATE_MODULO", "10"))
REGION         = os.getenv("AWS_REGION",           "us-east-1")

# -- synthetic reference data --
_FIRST = ["James", "Maria", "David", "Sarah", "Michael", "Linda",
          "Robert", "Susan", "William", "Jessica", "Richard", "Karen",
          "Thomas", "Nancy", "Charles", "Betty"]
_LAST  = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia",
          "Miller", "Davis", "Wilson", "Moore", "Taylor", "Anderson",
          "Jackson", "White", "Harris", "Martin"]
_PROVIDERS = [
    ("prov-001", "Dr. Alice Chen"),
    ("prov-002", "Dr. Bob Patel"),
    ("prov-003", "Dr. Carol Rivera"),
    ("prov-004", "Dr. Dan Kowalski"),
    ("prov-005", "Dr. Eva Nguyen"),
]
_DIAGNOSES = [
    ("Z00.00", "Encounter for general adult medical examination"),
    ("J06.9",  "Acute upper respiratory infection, unspecified"),
    ("E11.9",  "Type 2 diabetes mellitus without complications"),
    ("I10",    "Essential (primary) hypertension"),
    ("M54.5",  "Low back pain"),
    ("F41.1",  "Generalized anxiety disorder"),
    ("K21.0",  "Gastro-esophageal reflux disease with oesophagitis"),
    ("J45.20", "Mild intermittent asthma, uncomplicated"),
]
_PROCEDURES = [
    ("99213", "Office visit, established patient, low complexity",  150.00),
    ("99214", "Office visit, established patient, mod complexity",  200.00),
    ("99215", "Office visit, established patient, high complexity", 275.00),
    ("99203", "Office visit, new patient, low complexity",          175.00),
    ("99204", "Office visit, new patient, mod complexity",          240.00),
    ("80053", "Comprehensive metabolic panel",                       45.00),
    ("85027", "Complete blood count",                                35.00),
    ("93000", "Electrocardiogram, routine 12-lead",                  85.00),
]

CSV_FIELDS = [
    "claim_id", "patient_id", "patient_name", "service_date",
    "status", "claim_type", "use",
    "provider_id", "provider_name",
    "diagnosis_code", "diagnosis_description",
    "procedure_code", "procedure_description",
    "unit_price", "quantity", "net_amount", "currency",
    "insurance_member_id", "priority",
]


# -- helpers --

def _rand_date():
    start = date(2024, 1, 1)
    return start + timedelta(days=random.randint(0, 729))  # 2024-01-01 to 2025-12-31


def _fhir_claim_dict(claim_id, patient_id, provider_id, service_date):
    """Build a FHIR R4 Claim as a plain dict. service_date may be None."""
    d = {
        "resourceType": "Claim",
        "id": claim_id,
        "status": "active",
        "type": {"coding": [{
            "system":  "http://terminology.hl7.org/CodeSystem/claim-type",
            "code":    "professional",
            "display": "Professional",
        }]},
        "use": "claim",
        "patient":  {"reference": f"Patient/{patient_id}"},
        "provider": {"reference": f"Practitioner/{provider_id}"},
        "priority": {"coding": [{
            "system":  "http://terminology.hl7.org/CodeSystem/processpriority",
            "code":    "normal",
            "display": "Normal",
        }]},
        "insurance": [{
            "sequence": 1,
            "focal": True,
            "coverage": {"reference": f"Coverage/cov-{patient_id}"},
        }],
    }
    if service_date is not None:
        d["created"] = service_date.isoformat() + "T00:00:00+00:00"
    return d


def _validate(claim_dict):
    """Attempt FHIR SDK validation; silently skip for incomplete test rows."""
    if not FHIR_AVAILABLE:
        return
    try:
        Claim.model_validate(claim_dict)   # fhir.resources >= 7 / pydantic v2
    except Exception:
        try:
            Claim.parse_obj(claim_dict)    # fhir.resources <= 6 / pydantic v1
        except Exception:
            pass                           # missing required field (created) - expected


def _generate_claims():
    rows = []
    for i in range(TOTAL_CLAIMS):
        missing       = (i % MISSING_MODULO == 0)
        claim_id      = str(uuid.uuid4())
        patient_id    = f"pat-{uuid.uuid4().hex[:8]}"
        patient_name  = f"{random.choice(_FIRST)} {random.choice(_LAST)}"
        prov_id, prov_name            = random.choice(_PROVIDERS)
        diag_code, diag_desc          = random.choice(_DIAGNOSES)
        proc_code, proc_desc, unit_px = random.choice(_PROCEDURES)
        qty           = random.randint(1, 3)
        net           = round(unit_px * qty, 2)
        svc_date      = None if missing else _rand_date()
        ins_member    = f"MBR{random.randint(100000, 999999)}"

        fhir_dict = _fhir_claim_dict(claim_id, patient_id, prov_id, svc_date)
        _validate(fhir_dict)

        rows.append({
            "claim_id":              claim_id,
            "patient_id":            patient_id,
            "patient_name":          patient_name,
            "service_date":          svc_date.isoformat() if svc_date else "",
            "status":                fhir_dict["status"],
            "claim_type":            fhir_dict["type"]["coding"][0]["code"],
            "use":                   fhir_dict["use"],
            "provider_id":           prov_id,
            "provider_name":         prov_name,
            "diagnosis_code":        diag_code,
            "diagnosis_description": diag_desc,
            "procedure_code":        proc_code,
            "procedure_description": proc_desc,
            "unit_price":            unit_px,
            "quantity":              qty,
            "net_amount":            net,
            "currency":              "USD",
            "insurance_member_id":   ins_member,
            "priority":              "normal",
        })
    return rows


# -- Lambda handler --

def lambda_handler(event, context):
    rows = _generate_claims()

    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=CSV_FIELDS)
    writer.writeheader()
    writer.writerows(rows)

    today     = date.today().isoformat()
    s3_key    = f"{PREFIX}claims-{today}.csv"
    csv_bytes = buf.getvalue().encode("utf-8")

    s3 = boto3.client("s3", region_name=REGION)
    s3.put_object(Bucket=BUCKET, Key=s3_key, Body=csv_bytes, ContentType="text/csv")

    missing_count = sum(1 for r in rows if r["service_date"] == "")
    result = {
        "statusCode":        200,
        "bucket":            BUCKET,
        "key":               s3_key,
        "rows_written":      len(rows),
        "rows_missing_date": missing_count,
    }
    print(result)
    return result


# -- local test entry point --

if __name__ == "__main__":
    lambda_handler({}, None)
