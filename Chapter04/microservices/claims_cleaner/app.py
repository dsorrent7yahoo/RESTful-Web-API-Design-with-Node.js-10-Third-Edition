import importlib, os, sys
import boto3
from fastapi import FastAPI, Depends, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel
from typing import Optional
import jwt

app = FastAPI(title="Claims Cleaner Microservice")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


BUCKET        = os.getenv("STAGING_BUCKET", "dgs-glue-staging")
CLAIMS_PREFIX = os.getenv("CLAIMS_PREFIX",  "claims/")
PARQUET_PREFIX= os.getenv("CLEAN_PREFIX",   "claims-parquet/")
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

class CleanRequest(BaseModel):
    key: Optional[str] = None
    bucket: Optional[str] = None
    delete_after: bool = True

class ProcessAllRequest(BaseModel):
    bucket: Optional[str] = None
    delete_after: bool = True

@app.get("/health")
def health():
    return {"status": "ok", "service": "claims_cleaner"}

@app.post("/claims/clean")
@limiter.limit("10/minute")
def clean_claims(request: Request, req: CleanRequest, _user=Depends(require_jwt)):
    bucket = req.bucket or BUCKET
    key = req.key
    if not key:
        s3   = boto3.client("s3", region_name=REGION)
        resp = s3.list_objects_v2(Bucket=bucket, Prefix=CLAIMS_PREFIX)
        objs = sorted(resp.get("Contents", []), key=lambda x: x["LastModified"], reverse=True)
        if not objs:
            raise HTTPException(status_code=404, detail="No CSV files found in S3")
        key = objs[0]["Key"]
    _lambda_dir()
    try:
        import claims_cleaner as _mod
        importlib.reload(_mod)
        result = _mod.lambda_handler({"bucket": bucket, "key": key}, None)
        if req.delete_after and result.get("statusCode") == 200:
            boto3.client("s3", region_name=REGION).delete_object(Bucket=bucket, Key=key)
        return result
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

@app.post("/claims/process-all")
@limiter.limit("3/minute")
def process_all(request: Request, req: ProcessAllRequest, _user=Depends(require_jwt)):
    bucket = req.bucket or BUCKET
    _lambda_dir()
    try:
        import synthetic_fhir_claims as _gen
        import claims_cleaner as _clean
        importlib.reload(_gen); importlib.reload(_clean)
        gen_result = _gen.lambda_handler({}, None)
        if gen_result.get("statusCode") != 200:
            raise HTTPException(status_code=500, detail=str(gen_result))
        key = gen_result.get("key") or gen_result.get("body", {}).get("key")
        result = _clean.lambda_handler({"bucket": bucket, "key": key}, None)
        if req.delete_after and result.get("statusCode") == 200:
            boto3.client("s3", region_name=REGION).delete_object(Bucket=bucket, Key=key)
        return {"generate": gen_result, "clean": result}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

@app.get("/claims/parquet-files")
@limiter.limit("60/minute")
def list_parquet_files(request: Request, bucket: str = BUCKET, prefix: str = PARQUET_PREFIX, _user=Depends(require_jwt)):
    try:
        s3   = boto3.client("s3", region_name=REGION)
        resp = s3.list_objects_v2(Bucket=bucket, Prefix=prefix)
        files = [{"key": o["Key"], "size": o["Size"], "lastModified": o["LastModified"].isoformat()}
                 for o in resp.get("Contents", [])]
        return {"files": files, "count": len(files)}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=4012)
