"""lambda_condition.py — Generates synthetic FHIR R4 Condition records, uploads CSV to S3,
and registers/updates the Glue table 'conditions' in the database.
"""
import csv, io, json, os, time
from datetime import date, timedelta
import boto3
from glue_catalog_updater import register_table

BUCKET   = os.getenv("STAGING_BUCKET", "dgs-glue-staging")
PREFIX   = os.getenv("CONDITIONS_PREFIX", "conditions/")
TOTAL    = int(os.getenv("TOTAL_CONDITIONS", "100"))
REGION   = os.getenv("AWS_REGION", "us-east-1")
GLUE_DB  = os.getenv("GLUE_DATABASE", "fhir-table-db")

FIELDS   = ['condition_id', 'patient_id', 'code', 'display', 'onset_date', 'abatement_date', 'clinical_status', 'verification_status', 'severity', 'category']

_CONDITIONS = [
    ("E11.9","Type 2 diabetes mellitus without complications"),
    ("I10","Essential (primary) hypertension"),
    ("J45.20","Mild intermittent asthma, uncomplicated"),
    ("M54.5","Low back pain"),
    ("F41.1","Generalized anxiety disorder"),
    ("K21.0","Gastro-esophageal reflux disease"),
    ("J06.9","Acute upper respiratory infection"),
    ("Z00.00","General adult medical examination"),
    ("I25.10","Atherosclerotic heart disease"),
    ("N18.3","Chronic kidney disease, stage 3"),
]

def _gen_row():
    import random, uuid
    code, display = random.choice(_CONDITIONS)
    onset = (date(2020,1,1)+timedelta(days=random.randint(0,1825))).isoformat()
    abate = "" if random.random()<0.5 else (date.fromisoformat(onset)+timedelta(days=random.randint(30,730))).isoformat()
    return {
        "condition_id":          f"COND-{uuid.uuid4().hex[:8].upper()}",
        "patient_id":            f"PAT-{uuid.uuid4().hex[:8].upper()}",
        "code":                  code,
        "display":               display,
        "onset_date":            onset,
        "abatement_date":        abate,
        "clinical_status":       random.choice(["active","resolved","inactive"]),
        "verification_status":   "confirmed",
        "severity":              random.choice(["mild","moderate","severe",""]),
        "category":              random.choice(["encounter-diagnosis","problem-list-item"]),
    }

def lambda_handler(event, context):
    total  = event.get("total", TOTAL)
    rows   = [_gen_row() for _ in range(total)]
    buf    = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=FIELDS)
    writer.writeheader()
    writer.writerows(rows)
    key    = f"{PREFIX}conditions_{int(time.time())}.csv"
    s3     = boto3.client("s3", region_name=REGION)
    s3.put_object(Bucket=BUCKET, Key=key, Body=buf.getvalue().encode("utf-8"), ContentType="text/csv")
    cols   = [{"Name": f, "Type": "string"} for f in FIELDS]
    glue_r = register_table(GLUE_DB, "conditions", f"s3://{BUCKET}/{PREFIX}", cols)
    sqs_url = os.getenv("SQS_QUEUE_URL", "https://sqs.us-east-1.amazonaws.com/005905648819/dgs-fhir-lambda-results")
    try:
        boto3.client("sqs", region_name=REGION).send_message(
            QueueUrl=sqs_url,
            MessageBody=json.dumps({"resource": "Condition", "key": key, "total": total, "glue": glue_r}),
        )
    except Exception:
        pass
    return {"statusCode": 200, "key": key, "total": total, "glue": glue_r,
             "body": json.dumps({"key": key, "total": total})}
