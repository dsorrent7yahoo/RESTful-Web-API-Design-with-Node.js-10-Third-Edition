# Databricks notebook source
import csv, importlib, io, os, sys
import boto3
from fastapi import FastAPI, Depends, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
import jwt

app = FastAPI(title="Claims Generator Microservice")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


BUCKET        = os.getenv("STAGING_BUCKET", "dgs-glue-staging")
CLAIMS_PREFIX = os.getenv("CLAIMS_PREFIX",  "claims/")
REGION        = os.getenv("AWS_REGION",     "us-east-1")
LAMBDA_DIR    = os.getenv("LAMBDA_DIR", os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "django-back-end", "lambdas")))
JWT_SECRET    = os.getenv("JWT_SECRET", "health-care-dev-secret")
bearer = HTTPBearer()

def require_jwt(creds: HTTPAuthorizationCredentials = Depends(bearer)):
    try:
        return jwt.decode(creds.credentials, JWT_SECRET, algorithms=["HS256"],
                          options={"require": ["sub", "exp", "iat"]})
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {e}")

def _lambda_dir():
    if LAMBDA_DIR not in sys.path:
        sys.path.insert(0, LAMBDA_DIR)

@app.get("/health")
def health():
    return {"status": "ok", "service": "claims_generator"}

@app.post("/claims/generate")
@limiter.limit("5/minute")
def generate_claims(request: Request, _user=Depends(require_jwt)):
    _lambda_dir()
    try:
        import synthetic_fhir_claims as _gen
        importlib.reload(_gen)
        return _gen.lambda_handler({}, None)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

@app.get("/claims/files")
@limiter.limit("60/minute")
def list_claims_files(request: Request, bucket: str = BUCKET, prefix: str = CLAIMS_PREFIX, _user=Depends(require_jwt)):
    try:
        s3   = boto3.client("s3", region_name=REGION)
        resp = s3.list_objects_v2(Bucket=bucket, Prefix=prefix)
        files = [{"key": o["Key"], "name": o["Key"].split("/")[-1], "size": o["Size"], "lastModified": o["LastModified"].isoformat()}
                 for o in resp.get("Contents", [])]
        return {"files": files, "count": len(files)}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

@app.get("/claims/file")
@limiter.limit("60/minute")
def get_claims_file(request: Request, key: str = Query(...), bucket: str = BUCKET, _user=Depends(require_jwt)):
    try:
        s3  = boto3.client("s3", region_name=REGION)
        obj = s3.get_object(Bucket=bucket, Key=key)
        content = obj["Body"].read().decode("utf-8")
        rows = list(csv.DictReader(io.StringIO(content)))
        return {"key": key, "rows": rows, "count": len(rows)}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=4011)
