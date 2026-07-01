import csv, importlib, io, os, sys, uuid
from datetime import date, timedelta
import random
import boto3
from fastapi import FastAPI, Depends, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel
from typing import Optional
import jwt

app = FastAPI(title="Patients & Encounters Microservice")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

BUCKET            = os.getenv("STAGING_BUCKET",  "dgs-glue-staging")
PATIENTS_PREFIX   = os.getenv("PATIENTS_PREFIX", "patients/")
ENCOUNTERS_PREFIX = os.getenv("ENCOUNTERS_PREFIX","encounters/")
GLUE_DB           = os.getenv("GLUE_DATABASE",   "fhir-table-db")
REGION            = os.getenv("AWS_REGION",       "us-east-1")
LAMBDA_DIR        = os.getenv("LAMBDA_DIR", os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "django-back-end", "lambdas")))
JWT_SECRET        = os.getenv("JWT_SECRET",       "health-care-dev-secret")
TOTAL             = int(os.getenv("TOTAL_RECORDS", "100"))

bearer = HTTPBearer()

def require_jwt(creds: HTTPAuthorizationCredentials = Depends(bearer)):
    try:
        return jwt.decode(creds.credentials, JWT_SECRET, algorithms=["HS256"],
                          options={"require": ["sub", "exp", "iat"]})
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {e}")

# ── synthetic helpers ─────────────────────────────────────────────────────────
_FIRST = ["James","Maria","David","Sarah","Michael","Linda","Robert","Susan",
          "William","Jessica","Richard","Karen","Thomas","Nancy","Charles","Betty"]
_LAST  = ["Smith","Johnson","Williams","Brown","Jones","Garcia","Miller","Davis",
          "Wilson","Moore","Taylor","Anderson","Jackson","White","Harris","Martin"]
_GENDERS = ["male", "female", "other", "unknown"]
_RACES   = ["White","Black or African American","Asian","American Indian or Alaska Native","Other"]
_ENC_TYPES = [
    ("AMB",  "Ambulatory",           "outpatient"),
    ("EMER", "Emergency",            "emergency"),
    ("IMP",  "Inpatient Encounter",  "inpatient"),
    ("PRENC","Pre-Admission",        "outpatient"),
    ("SS",   "Short Stay",           "inpatient"),
]
_REASONS = [
    "Annual wellness visit","Chest pain","Shortness of breath","Fever",
    "Abdominal pain","Follow-up hypertension","Follow-up diabetes","Knee pain",
    "Back pain","Headache","Dizziness","Skin rash",
]
_PROVIDERS = [
    "Dr. Alice Chen","Dr. Bob Patel","Dr. Carol Rivera",
    "Dr. Dan Kowalski","Dr. Eva Nguyen",
]
_FACILITIES = [
    ("FAC-001","General Hospital","123 Main St"),
    ("FAC-002","Community Clinic","456 Oak Ave"),
    ("FAC-003","University Medical Center","789 College Blvd"),
]
PATIENT_FIELDS = [
    "patient_id","first_name","last_name","gender","birth_date",
    "race","ethnicity","address","city","state","zip",
    "phone","insurance_id","insurance_plan","active",
]
ENCOUNTER_FIELDS = [
    "encounter_id","patient_id","encounter_type_code","encounter_type_display",
    "status","class","encounter_date","end_date","reason","provider_name",
    "facility_id","facility_name","facility_address","duration_hours",
    "discharge_disposition",
]

def _rand_date(start_year=1940, end_year=2005):
    d = date(start_year, 1, 1) + timedelta(days=random.randint(0, (date(end_year,12,31)-date(start_year,1,1)).days))
    return d.isoformat()

def _rand_encounter_date():
    d = date(2024,1,1) + timedelta(days=random.randint(0,729))
    return d.isoformat()

def _gen_patient(pid):
    first = random.choice(_FIRST); last = random.choice(_LAST)
    return {
        "patient_id":     pid,
        "first_name":     first,
        "last_name":      last,
        "gender":         random.choice(_GENDERS),
        "birth_date":     _rand_date(),
        "race":           random.choice(_RACES),
        "ethnicity":      random.choice(["Hispanic or Latino","Not Hispanic or Latino"]),
        "address":        f"{random.randint(100,9999)} {random.choice(['Elm','Oak','Pine','Maple','Cedar'])} {random.choice(['St','Ave','Blvd','Dr'])}",
        "city":           random.choice(["Springfield","Shelbyville","Ogdenville","North Haverbrook"]),
        "state":          random.choice(["CA","TX","NY","FL","IL","PA","OH","GA","NC","MI"]),
        "zip":            f"{random.randint(10000,99999)}",
        "phone":          f"555-{random.randint(100,999)}-{random.randint(1000,9999)}",
        "insurance_id":   f"INS-{uuid.uuid4().hex[:8].upper()}",
        "insurance_plan": random.choice(["BlueCross PPO","Aetna HMO","UnitedHealth EPO","Cigna POS","Humana"]),
        "active":         "true",
    }

def _gen_encounter(patient_id):
    enc_code, enc_disp, cls = random.choice(_ENC_TYPES)
    start = _rand_encounter_date()
    dur   = random.randint(1, 72)
    facility = random.choice(_FACILITIES)
    return {
        "encounter_id":          f"ENC-{uuid.uuid4().hex[:10].upper()}",
        "patient_id":            patient_id,
        "encounter_type_code":   enc_code,
        "encounter_type_display":enc_disp,
        "status":                "finished",
        "class":                 cls,
        "encounter_date":        start,
        "end_date":              (date.fromisoformat(start) + timedelta(hours=dur)).isoformat(),
        "reason":                random.choice(_REASONS),
        "provider_name":         random.choice(_PROVIDERS),
        "facility_id":           facility[0],
        "facility_name":         facility[1],
        "facility_address":      facility[2],
        "duration_hours":        str(dur),
        "discharge_disposition": random.choice(["Home","Transferred","SNF","Home with services",""]),
    }

def _csv_bytes(fields, rows):
    buf = io.StringIO()
    w   = csv.DictWriter(buf, fieldnames=fields)
    w.writeheader(); w.writerows(rows)
    return buf.getvalue().encode("utf-8")

def _upload_and_register(key_prefix, filename, content_bytes, fields, table_name):
    s3   = boto3.client("s3",   region_name=REGION)
    glue = boto3.client("glue", region_name=REGION)
    key  = f"{key_prefix}{filename}"
    s3.put_object(Bucket=BUCKET, Key=key, Body=content_bytes, ContentType="text/csv")
    cols = [{"Name": f, "Type": "string"} for f in fields]
    sd   = {
        "Location":      f"s3://{BUCKET}/{key_prefix}",
        "InputFormat":   "org.apache.hadoop.mapred.TextInputFormat",
        "OutputFormat":  "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat",
        "SerdeInfo": {"SerializationLibrary": "org.apache.hadoop.hive.serde2.lazy.LazySimpleSerDe",
                      "Parameters": {"field.delim": ",", "skip.header.line.count": "1"}},
        "Columns": cols,
    }
    try:
        glue.get_table(DatabaseName=GLUE_DB, Name=table_name)
        glue.update_table(DatabaseName=GLUE_DB, TableInput={"Name": table_name, "StorageDescriptor": sd, "TableType": "EXTERNAL_TABLE"})
        action = "updated"
    except glue.exceptions.EntityNotFoundException:
        try: glue.get_database(Name=GLUE_DB)
        except glue.exceptions.EntityNotFoundException:
            glue.create_database(DatabaseInput={"Name": GLUE_DB})
        glue.create_table(DatabaseName=GLUE_DB, TableInput={"Name": table_name, "StorageDescriptor": sd, "TableType": "EXTERNAL_TABLE"})
        action = "created"
    return {"key": key, "table": table_name, "glue_action": action, "rows": len(list(csv.DictReader(io.StringIO(content_bytes.decode("utf-8")))))}

class GenerateRequest(BaseModel):
    total: Optional[int] = None

@app.get("/health")
def health():
    return {"status": "ok", "service": "patients_encounters"}

@app.post("/patients/generate")
def generate_patients(req: GenerateRequest = GenerateRequest(), _user=Depends(require_jwt)):
    try:
        total   = req.total or TOTAL
        rows    = [_gen_patient(f"PAT-{uuid.uuid4().hex[:8].upper()}") for _ in range(total)]
        import time; ts = int(time.time())
        fname   = f"patients_{ts}.csv"
        result  = _upload_and_register(PATIENTS_PREFIX, fname, _csv_bytes(PATIENT_FIELDS, rows), PATIENT_FIELDS, "patients")
        return {"statusCode": 200, "total": total, **result}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

@app.post("/encounters/generate")
def generate_encounters(req: GenerateRequest = GenerateRequest(), _user=Depends(require_jwt)):
    try:
        total   = req.total or TOTAL
        s3      = boto3.client("s3", region_name=REGION)
        resp    = s3.list_objects_v2(Bucket=BUCKET, Prefix=PATIENTS_PREFIX)
        objs    = sorted(resp.get("Contents", []), key=lambda x: x["LastModified"], reverse=True)
        patient_ids = []
        if objs:
            raw = s3.get_object(Bucket=BUCKET, Key=objs[0]["Key"])["Body"].read().decode("utf-8")
            patient_ids = [r["patient_id"] for r in csv.DictReader(io.StringIO(raw)) if r.get("patient_id")]
        if not patient_ids:
            patient_ids = [f"PAT-{uuid.uuid4().hex[:8].upper()}" for _ in range(total)]
        rows = [_gen_encounter(random.choice(patient_ids)) for _ in range(total)]
        import time; ts = int(time.time())
        fname  = f"encounters_{ts}.csv"
        result = _upload_and_register(ENCOUNTERS_PREFIX, fname, _csv_bytes(ENCOUNTER_FIELDS, rows), ENCOUNTER_FIELDS, "encounters")
        return {"statusCode": 200, "total": total, **result}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

@app.get("/patients/files")
def list_patients_files(_user=Depends(require_jwt)):
    try:
        s3   = boto3.client("s3", region_name=REGION)
        resp = s3.list_objects_v2(Bucket=BUCKET, Prefix=PATIENTS_PREFIX)
        files = [{"key": o["Key"], "size": o["Size"], "lastModified": o["LastModified"].isoformat()}
                 for o in resp.get("Contents", [])]
        return {"files": files, "count": len(files)}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

@app.get("/encounters/files")
def list_encounters_files(_user=Depends(require_jwt)):
    try:
        s3   = boto3.client("s3", region_name=REGION)
        resp = s3.list_objects_v2(Bucket=BUCKET, Prefix=ENCOUNTERS_PREFIX)
        files = [{"key": o["Key"], "size": o["Size"], "lastModified": o["LastModified"].isoformat()}
                 for o in resp.get("Contents", [])]
        return {"files": files, "count": len(files)}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=4015)
