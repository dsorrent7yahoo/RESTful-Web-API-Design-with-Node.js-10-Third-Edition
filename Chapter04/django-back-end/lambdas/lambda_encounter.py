"""lambda_encounter.py — Generates synthetic FHIR R4 Encounter records, uploads CSV to S3,
and registers/updates the Glue table 'encounters' in the database.
"""
import csv, io, json, os, time
from datetime import date, timedelta
import boto3
from glue_catalog_updater import register_table

BUCKET   = os.getenv("STAGING_BUCKET", "dgs-glue-staging")
PREFIX   = os.getenv("ENCOUNTERS_PREFIX", "encounters/")
TOTAL    = int(os.getenv("TOTAL_ENCOUNTERS", "100"))
REGION   = os.getenv("AWS_REGION", "us-east-1")
GLUE_DB  = os.getenv("GLUE_DATABASE", "fhir-table-db")

FIELDS   = ['encounter_id', 'patient_id', 'encounter_type_code', 'encounter_type_display', 'status', 'class', 'encounter_date', 'end_date', 'reason', 'provider_name', 'facility_id', 'facility_name', 'duration_hours', 'discharge_disposition']

_ENC_TYPES = [("AMB","Ambulatory","outpatient"),("EMER","Emergency","emergency"),
              ("IMP","Inpatient Encounter","inpatient"),("SS","Short Stay","inpatient")]
_REASONS   = ["Annual wellness visit","Chest pain","Shortness of breath","Fever",
               "Abdominal pain","Follow-up hypertension","Follow-up diabetes","Back pain"]
_PROVIDERS = ["Dr. Alice Chen","Dr. Bob Patel","Dr. Carol Rivera","Dr. Dan Kowalski","Dr. Eva Nguyen"]
_FACILITIES= [("FAC-001","General Hospital"),("FAC-002","Community Clinic"),("FAC-003","Univ Medical")]

def _gen_row():
    import random, uuid
    code, disp, cls = random.choice(_ENC_TYPES)
    start = (date(2024,1,1)+timedelta(days=random.randint(0,729))).isoformat()
    dur   = random.randint(1,72)
    fid, fname = random.choice(_FACILITIES)
    return {
        "encounter_id":           f"ENC-{uuid.uuid4().hex[:10].upper()}",
        "patient_id":             f"PAT-{uuid.uuid4().hex[:8].upper()}",
        "encounter_type_code":    code,
        "encounter_type_display": disp,
        "status":                 "finished",
        "class":                  cls,
        "encounter_date":         start,
        "end_date":               (date.fromisoformat(start)+timedelta(hours=dur)).isoformat(),
        "reason":                 random.choice(_REASONS),
        "provider_name":          random.choice(_PROVIDERS),
        "facility_id":            fid,
        "facility_name":          fname,
        "duration_hours":         str(dur),
        "discharge_disposition":  random.choice(["Home","Transferred","SNF","Home with services",""]),
    }

def lambda_handler(event, context):
    total  = event.get("total", TOTAL)
    rows   = [_gen_row() for _ in range(total)]
    buf    = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=FIELDS)
    writer.writeheader()
    writer.writerows(rows)
    key    = f"{PREFIX}encounters_{int(time.time())}.csv"
    s3     = boto3.client("s3", region_name=REGION)
    s3.put_object(Bucket=BUCKET, Key=key, Body=buf.getvalue().encode("utf-8"), ContentType="text/csv")
    cols   = [{"Name": f, "Type": "string"} for f in FIELDS]
    glue_r = register_table(GLUE_DB, "encounters", f"s3://{BUCKET}/{PREFIX}", cols)
    sqs_url = os.getenv("SQS_QUEUE_URL", "https://sqs.us-east-1.amazonaws.com/005905648819/dgs-fhir-lambda-results")
    try:
        boto3.client("sqs", region_name=REGION).send_message(
            QueueUrl=sqs_url,
            MessageBody=json.dumps({"resource": "Encounter", "key": key, "total": total, "glue": glue_r}),
        )
    except Exception:
        pass
    return {"statusCode": 200, "key": key, "total": total, "glue": glue_r,
             "body": json.dumps({"key": key, "total": total})}
