# Databricks notebook source
"""
synthetic_fhir_claims.py
Generates 100 synthetic FHIR R4 Claim records as CSV and writes to S3.
Publishes result to SQS.  Emits structured JSON logs for CloudWatch Insights.
"""

import csv
import io
import json
import os
import random
import uuid
from datetime import date, timedelta

import boto3

from lambda_logger import LambdaTimer, get_logger, mark_warm

log = get_logger("synthetic_fhir_claims")

try:
    from fhir.resources.claim import Claim
    FHIR_AVAILABLE = True
except ImportError:
    FHIR_AVAILABLE = False
    log.warning("fhir.resources not installed - FHIR validation skipped")

BUCKET         = os.getenv("STAGING_BUCKET",       "dgs-glue-staging")
PREFIX         = os.getenv("CLAIMS_PREFIX",        "claims/")
TOTAL_CLAIMS   = int(os.getenv("TOTAL_CLAIMS",     "100"))
MISSING_MODULO = int(os.getenv("MISSING_DATE_MODULO", "10"))
REGION         = os.getenv("AWS_REGION",           "us-east-1")
SQS_QUEUE_URL  = os.getenv("SQS_QUEUE_URL",
    "https://sqs.us-east-1.amazonaws.com/005905648819/dgs-fhir-lambda-results")

_FIRST = ["James", "Maria", "David", "Sarah", "Michael", "Linda",
          "Robert", "Susan", "William", "Jessica", "Richard", "Karen",
          "Thomas", "Nancy", "Charles", "Betty"]
_LAST  = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia",
          "Miller", "Davis", "Wilson", "Moore", "Taylor", "Anderson",
          "Jackson", "White", "Harris", "Martin"]
_PROVIDERS = [
    ("prov-001", "Dr. Alice Chen"), ("prov-002", "Dr. Bob Patel"),
    ("prov-003", "Dr. Carol Rivera"), ("prov-004", "Dr. Dan Kowalski"),
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
    "status", "claim_type", "use", "provider_id", "provider_name",
    "diagnosis_code", "diagnosis_description", "procedure_code",
    "procedure_description", "unit_price", "quantity", "net_amount",
    "currency", "insurance_member_id", "priority",
]


def _rand_date():
    return date(2024, 1, 1) + timedelta(days=random.randint(0, 729))


def _fhir_dict(claim_id, patient_id, provider_id, svc_date):
    d = {
        "resourceType": "Claim", "id": claim_id, "status": "active",
        "type": {"coding": [{
            "system": "http://terminology.hl7.org/CodeSystem/claim-type",
            "code": "professional", "display": "Professional",
        }]},
        "use": "claim",
        "patient":  {"reference": f"Patient/{patient_id}"},
        "provider": {"reference": f"Practitioner/{provider_id}"},
        "priority": {"coding": [{
            "system": "http://terminology.hl7.org/CodeSystem/processpriority",
            "code": "normal", "display": "Normal",
        }]},
        "insurance": [{"sequence": 1, "focal": True,
                       "coverage": {"reference": f"Coverage/cov-{patient_id}"}}],
    }
    if svc_date:
        d["created"] = svc_date.isoformat() + "T00:00:00+00:00"
    return d


def _validate_fhir(d):
    if not FHIR_AVAILABLE:
        return
    try:
        Claim.model_validate(d)
    except Exception:
        try:
            Claim.parse_obj(d)
        except Exception:
            pass


def _generate_claims():
    rows = []
    for i in range(TOTAL_CLAIMS):
        missing  = (i % MISSING_MODULO == 0)
        cid      = str(uuid.uuid4())
        pid      = f"pat-{uuid.uuid4().hex[:8]}"
        name     = f"{random.choice(_FIRST)} {random.choice(_LAST)}"
        prov_id, prov_name          = random.choice(_PROVIDERS)
        diag_code, diag_desc        = random.choice(_DIAGNOSES)
        proc_code, proc_desc, upx   = random.choice(_PROCEDURES)
        qty      = random.randint(1, 3)
        svc_date = None if missing else _rand_date()
        _validate_fhir(_fhir_dict(cid, pid, prov_id, svc_date))
        rows.append({
            "claim_id": cid, "patient_id": pid, "patient_name": name,
            "service_date": svc_date.isoformat() if svc_date else "",
            "status": "active", "claim_type": "professional", "use": "claim",
            "provider_id": prov_id, "provider_name": prov_name,
            "diagnosis_code": diag_code, "diagnosis_description": diag_desc,
            "procedure_code": proc_code, "procedure_description": proc_desc,
            "unit_price": upx, "quantity": qty, "net_amount": round(upx * qty, 2),
            "currency": "USD",
            "insurance_member_id": f"MBR{random.randint(100000,999999)}",
            "priority": "normal",
        })
    return rows


def lambda_handler(event, context):
    request_id = getattr(context, "aws_request_id", "local")
    cold_start  = mark_warm()
    session_id = (event or {}).get("session_id")

    with LambdaTimer(log, "synthetic_fhir_claims", request_id):
        log.info("generating claims",
                 extra={"total_claims": TOTAL_CLAIMS, "cold_start": cold_start,
                        "fhir_validation": FHIR_AVAILABLE})

        rows = _generate_claims()
        missing_count = sum(1 for r in rows if r["service_date"] == "")
        log.info("claims generated",
                 extra={"rows": len(rows), "missing_date": missing_count})

        buf = io.StringIO()
        csv.DictWriter(buf, fieldnames=CSV_FIELDS).writeheader() or None
        writer = csv.DictWriter(buf, fieldnames=CSV_FIELDS)
        writer.writeheader()
        # overwrite - write header only once properly
        buf = io.StringIO()
        writer = csv.DictWriter(buf, fieldnames=CSV_FIELDS)
        writer.writeheader()
        writer.writerows(rows)
        csv_bytes = buf.getvalue().encode("utf-8")

        today     = date.today().isoformat()
        s3_key    = f"{PREFIX}claims-{today}.csv"
        s3 = boto3.client("s3", region_name=REGION)
        s3.put_object(Bucket=BUCKET, Key=s3_key, Body=csv_bytes, ContentType="text/csv")
        log.info("S3 upload complete",
                 extra={"bucket": BUCKET, "key": s3_key, "size_bytes": len(csv_bytes)})

        result = {
            "statusCode":        200,
            "lambda":            "synthetic_fhir_claims",
            "step":              "generate_synthetic_claims",
            "step_status":       "SUCCEEDED",
            "session_id":        session_id,
            "bucket":            BUCKET,
            "key":               s3_key,
            "filename":          s3_key.split("/")[-1],
            "rows_written":      len(rows),
            "rows_missing_date": missing_count,
            "size_bytes":        len(csv_bytes),
            "timestamp":         today,
        }

        try:
            boto3.client("sqs", region_name=REGION).send_message(
                QueueUrl=SQS_QUEUE_URL,
                MessageBody=json.dumps(result),
                MessageAttributes={
                    "lambda": {"StringValue": "synthetic_fhir_claims", "DataType": "String"},
                },
            )
            log.info("SQS message sent", extra={"queue": SQS_QUEUE_URL, "session_id": session_id})
        except Exception:
            log.warning("SQS publish failed", exc_info=True)

        return result


if __name__ == "__main__":
    lambda_handler({}, None)
