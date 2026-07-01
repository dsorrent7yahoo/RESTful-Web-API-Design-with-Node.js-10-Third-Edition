"""lambda_immunization.py — Generates synthetic FHIR R4 Immunization records, uploads CSV to S3,
and registers/updates the Glue table 'immunizations' in the database.
"""
import csv, io, json, os, time
from datetime import date, timedelta
import boto3
from glue_catalog_updater import register_table

BUCKET   = os.getenv("STAGING_BUCKET", "dgs-glue-staging")
PREFIX   = os.getenv("IMMUNIZATIONS_PREFIX", "immunizations/")
TOTAL    = int(os.getenv("TOTAL_IMMUNIZATIONS", "100"))
REGION   = os.getenv("AWS_REGION", "us-east-1")
GLUE_DB  = os.getenv("GLUE_DATABASE", "fhir-table-db")

FIELDS   = ['immunization_id', 'patient_id', 'vaccine_code', 'vaccine_display', 'occurrence_date', 'status', 'dose_number', 'series', 'lot_number', 'performer', 'site', 'route']

_VACCINES = [
    ("08","Hep B, adolescent or pediatric"),("20","DTaP"),("49","Hib (PRP-OMP)"),
    ("10","IPV"),("21","Varicella"),("94","MMRV"),("133","PCV13"),
    ("141","Influenza, seasonal, injectable"),("207","COVID-19, mRNA"),
    ("208","COVID-19, mRNA, LNP-S, PF, 100 mcg/0.5mL dose"),
]
_SITES    = ["left arm","right arm","left thigh","right thigh"]
_ROUTES   = ["intramuscular","subcutaneous","intranasal","oral"]
_SERIES   = ["primary series","booster","catch-up","annual"]

def _gen_row():
    import random, uuid
    code, display = random.choice(_VACCINES)
    return {
        "immunization_id":  f"IMM-{uuid.uuid4().hex[:8].upper()}",
        "patient_id":       f"PAT-{uuid.uuid4().hex[:8].upper()}",
        "vaccine_code":     code,
        "vaccine_display":  display,
        "occurrence_date":  (date(2020,1,1)+timedelta(days=random.randint(0,1825))).isoformat(),
        "status":           "completed",
        "dose_number":      str(random.randint(1,4)),
        "series":           random.choice(_SERIES),
        "lot_number":       f"LOT-{uuid.uuid4().hex[:6].upper()}",
        "performer":        random.choice(["Dr. Alice Chen","Dr. Bob Patel","Nurse Smith","Nurse Davis"]),
        "site":             random.choice(_SITES),
        "route":            random.choice(_ROUTES),
    }

def lambda_handler(event, context):
    total  = event.get("total", TOTAL)
    rows   = [_gen_row() for _ in range(total)]
    buf    = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=FIELDS)
    writer.writeheader()
    writer.writerows(rows)
    key    = f"{PREFIX}immunizations_{int(time.time())}.csv"
    s3     = boto3.client("s3", region_name=REGION)
    s3.put_object(Bucket=BUCKET, Key=key, Body=buf.getvalue().encode("utf-8"), ContentType="text/csv")
    cols   = [{"Name": f, "Type": "string"} for f in FIELDS]
    glue_r = register_table(GLUE_DB, "immunizations", f"s3://{BUCKET}/{PREFIX}", cols)
    sqs_url = os.getenv("SQS_QUEUE_URL", "https://sqs.us-east-1.amazonaws.com/005905648819/dgs-fhir-lambda-results")
    try:
        boto3.client("sqs", region_name=REGION).send_message(
            QueueUrl=sqs_url,
            MessageBody=json.dumps({"resource": "Immunization", "key": key, "total": total, "glue": glue_r}),
        )
    except Exception:
        pass
    return {"statusCode": 200, "key": key, "total": total, "glue": glue_r,
             "body": json.dumps({"key": key, "total": total})}
