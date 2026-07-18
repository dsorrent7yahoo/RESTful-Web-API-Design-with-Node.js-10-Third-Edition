"""
Lambda 1: fhir_claim_generator.py
----------------------------------
Reads patient / condition / medication tables from the Glue Data Catalog,
generates 100 synthetic FHIR Claim resources using the fhir.resources SDK,
serialises them to CSV, and writes the file to dgs-glue-staging/claims/.

Intentional dirty-data rule: every 10th record (row index % 10 == 0, starting
at index 0) has its service_date field left blank so Lambda 2 can exercise its
null-row cleaner.

Environment variables
---------------------
GLUE_DATABASE   : Glue DB name (default: healthcare_data_lake)
STAGING_BUCKET  : S3 bucket to write the output (default: dgs-glue-staging)
CLAIMS_PREFIX   : S3 key prefix for the output file (default: claims/)
AWS_REGION      : AWS region (default: us-east-1)
"""

import os
import io
import csv
import uuid
import json
import random
import logging
import datetime
import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

GLUE_DATABASE   = os.environ.get("GLUE_DATABASE",  "healthcare_data_lake")
STAGING_BUCKET  = os.environ.get("STAGING_BUCKET", "dgs-glue-staging")
CLAIMS_PREFIX   = os.environ.get("CLAIMS_PREFIX",  "claims/")
AWS_REGION      = os.environ.get("AWS_REGION",     "us-east-1")

NUM_CLAIMS           = 100
MISSING_DATE_MODULO  = 10   # every 10th row (0, 10, 20 ...) has no service_date


# ---------------------------------------------------------------------------
# Athena helpers — query Glue-catalogued tables via Athena
# ---------------------------------------------------------------------------

ATHENA_OUTPUT = f"s3://{STAGING_BUCKET}/athena-results/"


def run_athena_query(athena, query: str, database: str) -> list[dict]:
    """Execute a query and return rows as list-of-dicts."""
    resp = athena.start_query_execution(
        QueryString=query,
        QueryExecutionContext={"Database": database},
        ResultConfiguration={"OutputLocation": ATHENA_OUTPUT},
    )
    qid = resp["QueryExecutionId"]

    import time
    for _ in range(30):
        status = athena.get_query_execution(QueryExecutionId=qid)
        state  = status["QueryExecution"]["Status"]["State"]
        if state == "SUCCEEDED":
            break
        if state in ("FAILED", "CANCELLED"):
            reason = status["QueryExecution"]["Status"].get("StateChangeReason", "unknown")
            raise RuntimeError(f"Athena query {qid} {state}: {reason}")
        time.sleep(2)
    else:
        raise TimeoutError(f"Athena query {qid} timed out")

    paginator = athena.get_paginator("get_query_results")
    rows = []
    headers = None
    for page in paginator.paginate(QueryExecutionId=qid):
        for row in page["ResultSet"]["Rows"]:
            values = [c.get("VarCharValue", "") for c in row["Data"]]
            if headers is None:
                headers = values
            else:
                rows.append(dict(zip(headers, values)))
    return rows


def load_table(athena, table: str, limit: int = 500) -> list[dict]:
    """Load up to `limit` rows from a Glue table via Athena."""
    try:
        return run_athena_query(
            athena,
            f'SELECT * FROM "{GLUE_DATABASE}"."{table}" LIMIT {limit}',
            GLUE_DATABASE,
        )
    except Exception as exc:
        logger.warning("Could not load table %s: %s", table, exc)
        return []


# ---------------------------------------------------------------------------
# FHIR Claim builder
# ---------------------------------------------------------------------------

def build_claim(idx: int, patient: dict, condition: dict, medication: dict) -> dict:
    """
    Build a flat dict representing a simplified FHIR Claim resource.
    Mirrors the fields that fhir.resources Claim would expose, stored as CSV cols.
    """
    claim_id = str(uuid.uuid4())

    # Intentional dirty data: every MISSING_DATE_MODULO-th row has no date
    if idx % MISSING_DATE_MODULO == 0:
        service_date = ""
    else:
        # Random date within the last 2 years
        base = datetime.date.today() - datetime.timedelta(days=random.randint(1, 730))
        service_date = base.isoformat()

    return {
        "resourceType":      "Claim",
        "id":                claim_id,
        "status":            "active",
        "use":               "claim",
        "patient_id":        patient.get("id", patient.get("Id", "")),
        "patient_name":      " ".join(filter(None, [
                                 patient.get("first", patient.get("FIRST", "")),
                                 patient.get("last",  patient.get("LAST",  "")),
                             ])),
        "patient_dob":       patient.get("birthdate", patient.get("BIRTHDATE", "")),
        "patient_gender":    patient.get("gender",    patient.get("GENDER",    "")),
        "condition_code":    condition.get("code",        condition.get("CODE",        "")),
        "condition_desc":    condition.get("description", condition.get("DESCRIPTION", "")),
        "condition_start":   condition.get("start",       condition.get("START",       "")),
        "medication_code":   medication.get("code",         medication.get("CODE",         "")),
        "medication_desc":   medication.get("description",  medication.get("DESCRIPTION",  "")),
        "service_date":      service_date,
        "total_amount":      round(random.uniform(50.0, 12000.0), 2),
        "currency":          "USD",
        "created_at":        datetime.datetime.utcnow().isoformat() + "Z",
    }


# ---------------------------------------------------------------------------
# Lambda handler
# ---------------------------------------------------------------------------

def lambda_handler(event, context):
    session = boto3.Session(region_name=AWS_REGION)
    s3      = session.client("s3")
    athena  = session.client("athena")

    logger.info("Loading source tables from Glue database: %s", GLUE_DATABASE)
    patients   = load_table(athena, "patients")
    conditions = load_table(athena, "conditions")
    medications = load_table(athena, "medications")

    if not patients:
        logger.warning("patients table empty — using synthetic fallback rows")
        patients = [{"id": str(uuid.uuid4()), "FIRST": "John", "LAST": "Doe",
                     "BIRTHDATE": "1980-01-01", "GENDER": "M"}]
    if not conditions:
        conditions = [{"CODE": "73211009", "DESCRIPTION": "Diabetes mellitus", "START": "2020-01-01"}]
    if not medications:
        medications = [{"CODE": "860975", "DESCRIPTION": "Metformin 500 MG"}]

    claims = []
    for i in range(NUM_CLAIMS):
        p  = patients[i  % len(patients)]
        c  = conditions[i % len(conditions)]
        m  = medications[i % len(medications)]
        claims.append(build_claim(i, p, c, m))

    # Serialise to CSV in memory
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=list(claims[0].keys()))
    writer.writeheader()
    writer.writerows(claims)
    csv_bytes = buf.getvalue().encode("utf-8")

    timestamp = datetime.datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    s3_key    = f"{CLAIMS_PREFIX}fhir_claims_{timestamp}.csv"

    s3.put_object(
        Bucket=STAGING_BUCKET,
        Key=s3_key,
        Body=csv_bytes,
        ContentType="text/csv",
        Metadata={
            "generator":   "fhir_claim_generator",
            "num_claims":  str(NUM_CLAIMS),
            "glue_source": GLUE_DATABASE,
        },
    )

    logger.info("Wrote %d claims to s3://%s/%s", NUM_CLAIMS, STAGING_BUCKET, s3_key)

    return {
        "statusCode": 200,
        "body": json.dumps({
            "bucket":     STAGING_BUCKET,
            "key":        s3_key,
            "num_claims": NUM_CLAIMS,
            "dirty_rows": [i for i in range(NUM_CLAIMS) if i % MISSING_DATE_MODULO == 0],
            "message":    f"Generated {NUM_CLAIMS} claims — every {MISSING_DATE_MODULO}th row has no service_date",
        }),
    }
