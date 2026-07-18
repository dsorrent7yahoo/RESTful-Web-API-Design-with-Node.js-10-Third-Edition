import io, os, boto3
from fastapi import FastAPI, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from typing import List
import jwt

app = FastAPI(title="Glue Catalog Microservice")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


BUCKET   = os.getenv("STAGING_BUCKET", "dgs-glue-staging")
REGION   = os.getenv("AWS_REGION", "us-east-1")
GLUE_DB  = os.getenv("GLUE_DATABASE", "fhir-table-db")
JWT_SECRET = os.getenv("JWT_SECRET", "health-care-dev-secret")
bearer = HTTPBearer()

def require_jwt(creds: HTTPAuthorizationCredentials = Depends(bearer)):
    try:
        return jwt.decode(creds.credentials, JWT_SECRET, algorithms=["HS256"],
                          options={"require": ["sub", "exp", "iat"]})
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {e}")

def _register_table(glue, database: str, table_name: str, s3_location: str, columns: list):
    sd = {
        "Location": s3_location,
        "InputFormat":  "org.apache.hadoop.mapred.TextInputFormat",
        "OutputFormat": "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat",
        "SerdeInfo": {
            "SerializationLibrary": "org.apache.hadoop.hive.serde2.lazy.LazySimpleSerDe",
            "Parameters": {"field.delim": ",", "skip.header.line.count": "1"},
        },
        "Columns": columns,
    }
    try:
        glue.get_table(DatabaseName=database, Name=table_name)
        glue.update_table(DatabaseName=database, TableInput={"Name": table_name, "StorageDescriptor": sd, "TableType": "EXTERNAL_TABLE"})
        return "updated"
    except glue.exceptions.EntityNotFoundException:
        try:
            glue.get_database(Name=database)
        except glue.exceptions.EntityNotFoundException:
            glue.create_database(DatabaseInput={"Name": database})
        glue.create_table(DatabaseName=database, TableInput={"Name": table_name, "StorageDescriptor": sd, "TableType": "EXTERNAL_TABLE"})
        return "created"

@app.get("/health")
def health():
    return {"status": "ok", "service": "glue_catalog"}

@app.post("/upload/glue-csv")
@limiter.limit("10/minute")
async def upload_glue_csv(request: Request,
    files: List[UploadFile] = File(..., alias="files[]"),
    bucket: str = Form(BUCKET),
    database: str = Form(GLUE_DB),
    _user = Depends(require_jwt),
):
    s3   = boto3.client("s3", region_name=REGION)
    glue = boto3.client("glue", region_name=REGION)
    results = []
    for f in files:
        raw = await f.read()
        key = f"glue-csv/{f.filename}"
        s3.put_object(Bucket=bucket, Key=key, Body=raw, ContentType="text/csv")
        import csv, io
        cols = []
        try:
            reader = csv.DictReader(io.StringIO(raw.decode("utf-8")))
            cols = [{"Name": c, "Type": "string"} for c in (reader.fieldnames or [])]
        except Exception:
            pass
        table_name = os.path.splitext(f.filename)[0].replace("-", "_").replace(" ", "_").lower()
        s3_loc = f"s3://{bucket}/glue-csv/"
        action = _register_table(glue, database, table_name, s3_loc, cols)
        results.append({"file": f.filename, "key": key, "table": table_name, "action": action, "columns": len(cols)})
    return {"status": "ok", "uploaded": len(results), "results": results}
