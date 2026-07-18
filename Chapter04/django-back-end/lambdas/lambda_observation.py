"""lambda_observation.py — Generates synthetic FHIR R4 Observation records, uploads CSV to S3,
and registers/updates the Glue table 'observations' in the database.
"""
import csv, io, json, os, time
from datetime import date, timedelta
import boto3
from glue_catalog_updater import register_table

BUCKET   = os.getenv("STAGING_BUCKET", "dgs-glue-staging")
PREFIX   = os.getenv("OBSERVATIONS_PREFIX", "observations/")
TOTAL    = int(os.getenv("TOTAL_OBSERVATIONS", "100"))
REGION   = os.getenv("AWS_REGION", "us-east-1")
GLUE_DB  = os.getenv("GLUE_DATABASE", "fhir-table-db")

FIELDS   = ['observation_id', 'patient_id', 'code', 'display', 'value', 'unit', 'effective_date', 'status', 'category', 'interpretation']

_OBS = [
    ("8302-2","Body Height","cm",150,200),
    ("29463-7","Body Weight","kg",50,130),
    ("8480-6","Systolic Blood Pressure","mmHg",90,180),
    ("8462-4","Diastolic Blood Pressure","mmHg",60,120),
    ("8867-4","Heart Rate","bpm",55,100),
    ("2339-0","Glucose [Mass/volume] in Blood","mg/dL",70,200),
    ("4548-4","Hemoglobin A1c/Hemoglobin.total in Blood","%",4.0,12.0),
    ("2085-9","Cholesterol in HDL [Mass/volume] in Serum","mg/dL",30,80),
]
_INTERP = ["normal","high","low","critical-high","critical-low",""]

def _gen_row():
    import random, uuid
    code, display, unit, lo, hi = random.choice(_OBS)
    val = round(random.uniform(lo, hi), 1)
    return {
        "observation_id": f"OBS-{uuid.uuid4().hex[:10].upper()}",
        "patient_id":     f"PAT-{uuid.uuid4().hex[:8].upper()}",
        "code":           code,
        "display":        display,
        "value":          str(val),
        "unit":           unit,
        "effective_date": (date(2024,1,1)+timedelta(days=random.randint(0,729))).isoformat(),
        "status":         "final",
        "category":       "laboratory",
        "interpretation": random.choice(_INTERP),
    }

def lambda_handler(event, context):
    total  = event.get("total", TOTAL)
    rows   = [_gen_row() for _ in range(total)]
    buf    = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=FIELDS)
    writer.writeheader()
    writer.writerows(rows)
    key    = f"{PREFIX}observations_{int(time.time())}.csv"
    s3     = boto3.client("s3", region_name=REGION)
    s3.put_object(Bucket=BUCKET, Key=key, Body=buf.getvalue().encode("utf-8"), ContentType="text/csv")
    cols   = [{"Name": f, "Type": "string"} for f in FIELDS]
    glue_r = register_table(GLUE_DB, "observations", f"s3://{BUCKET}/{PREFIX}", cols)
    sqs_url = os.getenv("SQS_QUEUE_URL", "https://sqs.us-east-1.amazonaws.com/005905648819/dgs-fhir-lambda-results")
    try:
        boto3.client("sqs", region_name=REGION).send_message(
            QueueUrl=sqs_url,
            MessageBody=json.dumps({"resource": "Observation", "key": key, "total": total, "glue": glue_r}),
        )
    except Exception:
        pass
    return {"statusCode": 200, "key": key, "total": total, "glue": glue_r,
             "body": json.dumps({"key": key, "total": total})}
