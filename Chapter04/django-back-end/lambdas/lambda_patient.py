"""lambda_patient.py — Generates synthetic FHIR R4 Patient records, uploads CSV to S3,
and registers/updates the Glue table 'patients' in the database.
"""
import csv, io, json, os, time
from datetime import date, timedelta
import boto3
from glue_catalog_updater import register_table

BUCKET   = os.getenv("STAGING_BUCKET", "dgs-glue-staging")
PREFIX   = os.getenv("PATIENTS_PREFIX", "patients/")
TOTAL    = int(os.getenv("TOTAL_PATIENTS", "100"))
REGION   = os.getenv("AWS_REGION", "us-east-1")
GLUE_DB  = os.getenv("GLUE_DATABASE", "fhir-table-db")

FIELDS   = ['patient_id', 'first_name', 'last_name', 'gender', 'birth_date', 'race', 'ethnicity', 'address', 'city', 'state', 'zip', 'phone', 'insurance_id', 'insurance_plan', 'active']

_FIRST = ["James","Maria","David","Sarah","Michael","Linda","Robert","Susan",
          "William","Jessica","Richard","Karen","Thomas","Nancy","Charles","Betty"]
_LAST  = ["Smith","Johnson","Williams","Brown","Jones","Garcia","Miller","Davis",
          "Wilson","Moore","Taylor","Anderson","Jackson","White","Harris","Martin"]

def _gen_row():
    import random, uuid
    first = random.choice(_FIRST); last = random.choice(_LAST)
    return {
        "patient_id":     f"PAT-{uuid.uuid4().hex[:8].upper()}",
        "first_name":     first,
        "last_name":      last,
        "gender":         random.choice(["male","female","other","unknown"]),
        "birth_date":     (date(1940,1,1)+timedelta(days=random.randint(0,23725))).isoformat(),
        "race":           random.choice(["White","Black or African American","Asian","American Indian or Alaska Native","Other"]),
        "ethnicity":      random.choice(["Hispanic or Latino","Not Hispanic or Latino"]),
        "address":        f"{random.randint(100,9999)} {random.choice(['Elm','Oak','Pine','Maple'])} {random.choice(['St','Ave','Blvd','Dr'])}",
        "city":           random.choice(["Springfield","Shelbyville","Ogdenville","North Haverbrook"]),
        "state":          random.choice(["CA","TX","NY","FL","IL","PA","OH","GA","NC","MI"]),
        "zip":            f"{random.randint(10000,99999)}",
        "phone":          f"555-{random.randint(100,999)}-{random.randint(1000,9999)}",
        "insurance_id":   f"INS-{uuid.uuid4().hex[:8].upper()}",
        "insurance_plan": random.choice(["BlueCross PPO","Aetna HMO","UnitedHealth EPO","Cigna POS","Humana"]),
        "active":         "true",
    }

def lambda_handler(event, context):
    total  = event.get("total", TOTAL)
    rows   = [_gen_row() for _ in range(total)]
    buf    = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=FIELDS)
    writer.writeheader()
    writer.writerows(rows)
    key    = f"{PREFIX}patients_{int(time.time())}.csv"
    s3     = boto3.client("s3", region_name=REGION)
    s3.put_object(Bucket=BUCKET, Key=key, Body=buf.getvalue().encode("utf-8"), ContentType="text/csv")
    cols   = [{"Name": f, "Type": "string"} for f in FIELDS]
    glue_r = register_table(GLUE_DB, "patients", f"s3://{BUCKET}/{PREFIX}", cols)
    sqs_url = os.getenv("SQS_QUEUE_URL", "https://sqs.us-east-1.amazonaws.com/005905648819/dgs-fhir-lambda-results")
    try:
        boto3.client("sqs", region_name=REGION).send_message(
            QueueUrl=sqs_url,
            MessageBody=json.dumps({"resource": "Patient", "key": key, "total": total, "glue": glue_r}),
        )
    except Exception:
        pass
    return {"statusCode": 200, "key": key, "total": total, "glue": glue_r,
             "body": json.dumps({"key": key, "total": total})}
