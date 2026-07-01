"""lambda_medication.py — Generates synthetic FHIR R4 MedicationRequest records, uploads CSV to S3,
and registers/updates the Glue table 'medications' in the database.
"""
import csv, io, json, os, time
from datetime import date, timedelta
import boto3
from glue_catalog_updater import register_table

BUCKET   = os.getenv("STAGING_BUCKET", "dgs-glue-staging")
PREFIX   = os.getenv("MEDICATIONS_PREFIX", "medications/")
TOTAL    = int(os.getenv("TOTAL_MEDICATIONS", "100"))
REGION   = os.getenv("AWS_REGION", "us-east-1")
GLUE_DB  = os.getenv("GLUE_DATABASE", "fhir-table-db")

FIELDS   = ['medication_id', 'patient_id', 'medication_code', 'medication_display', 'status', 'intent', 'authored_on', 'dosage_text', 'route', 'frequency', 'prescriber', 'days_supply']

_MEDS = [
    ("1049502","Metformin 500 MG"),("197361","Lisinopril 10 MG"),
    ("308460","Atorvastatin 20 MG"),("197517","Amlodipine 5 MG"),
    ("311702","Omeprazole 20 MG"),("855332","Albuterol 0.09 MG/ACTUAT"),
    ("213269","Levothyroxine 50 MCG"),("993770","Sertraline 50 MG"),
    ("866514","Metoprolol 25 MG"),("209459","Hydrochlorothiazide 25 MG"),
]
_ROUTES   = ["oral","inhalation","topical","subcutaneous","intravenous"]
_FREQS    = ["once daily","twice daily","three times daily","as needed","weekly"]
_PROVIDERS= ["Dr. Alice Chen","Dr. Bob Patel","Dr. Carol Rivera","Dr. Dan Kowalski"]

def _gen_row():
    import random, uuid
    code, display = random.choice(_MEDS)
    return {
        "medication_id":       f"MED-{uuid.uuid4().hex[:8].upper()}",
        "patient_id":          f"PAT-{uuid.uuid4().hex[:8].upper()}",
        "medication_code":     code,
        "medication_display":  display,
        "status":              random.choice(["active","completed","stopped"]),
        "intent":              "order",
        "authored_on":         (date(2024,1,1)+timedelta(days=random.randint(0,729))).isoformat(),
        "dosage_text":         f"Take 1 tablet {random.choice(_FREQS)}",
        "route":               random.choice(_ROUTES),
        "frequency":           random.choice(_FREQS),
        "prescriber":          random.choice(_PROVIDERS),
        "days_supply":         str(random.choice([30,60,90])),
    }

def lambda_handler(event, context):
    total  = event.get("total", TOTAL)
    rows   = [_gen_row() for _ in range(total)]
    buf    = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=FIELDS)
    writer.writeheader()
    writer.writerows(rows)
    key    = f"{PREFIX}medications_{int(time.time())}.csv"
    s3     = boto3.client("s3", region_name=REGION)
    s3.put_object(Bucket=BUCKET, Key=key, Body=buf.getvalue().encode("utf-8"), ContentType="text/csv")
    cols   = [{"Name": f, "Type": "string"} for f in FIELDS]
    glue_r = register_table(GLUE_DB, "medications", f"s3://{BUCKET}/{PREFIX}", cols)
    sqs_url = os.getenv("SQS_QUEUE_URL", "https://sqs.us-east-1.amazonaws.com/005905648819/dgs-fhir-lambda-results")
    try:
        boto3.client("sqs", region_name=REGION).send_message(
            QueueUrl=sqs_url,
            MessageBody=json.dumps({"resource": "MedicationRequest", "key": key, "total": total, "glue": glue_r}),
        )
    except Exception:
        pass
    return {"statusCode": 200, "key": key, "total": total, "glue": glue_r,
             "body": json.dumps({"key": key, "total": total})}
