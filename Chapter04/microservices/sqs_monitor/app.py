import json, os, threading
import boto3
from boto3.dynamodb.conditions import Key as DynamoKey
from fastapi import FastAPI, Depends, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel
import jwt

app = FastAPI(title="SQS Monitor Microservice")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


REGION        = os.getenv("AWS_REGION", "us-east-1")
SQS_QUEUE_URL = os.getenv("SQS_QUEUE_URL", "https://sqs.us-east-1.amazonaws.com/005905648819/dgs-fhir-lambda-results")
DLQ_QUEUE_URL = os.getenv("DLQ_QUEUE_URL", "https://sqs.us-east-1.amazonaws.com/005905648819/dgs-fhir-lambda-results-dlq")
DYNAMO_TABLE  = os.getenv("DYNAMO_EMAIL_LOG_TABLE", "dgs-sqs-email-log")
JWT_SECRET    = os.getenv("JWT_SECRET", "health-care-dev-secret")

bearer = HTTPBearer()
_email_log: list = []
_log_lock = threading.Lock()

def require_jwt(creds: HTTPAuthorizationCredentials = Depends(bearer)):
    try:
        return jwt.decode(creds.credentials, JWT_SECRET, algorithms=["HS256"],
                          options={"require": ["sub", "exp", "iat"]})
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {e}")

def _sqs(): return boto3.client("sqs", region_name=REGION)
def _dynamo(): return boto3.resource("dynamodb", region_name=REGION)

class AckRequest(BaseModel):
    receiptHandle: str

@app.get("/health")
def health():
    return {"status": "ok", "service": "sqs_monitor"}

@app.get("/sqs/messages")
@limiter.limit("30/minute")
def get_messages(request: Request, max: int = Query(10, le=10), _user=Depends(require_jwt)):
    resp = _sqs().receive_message(
        QueueUrl=SQS_QUEUE_URL, MaxNumberOfMessages=max,
        WaitTimeSeconds=1, MessageAttributeNames=["All"], AttributeNames=["All"],
    )
    msgs = []
    for m in resp.get("Messages", []):
        try: body = json.loads(m["Body"])
        except Exception: body = m["Body"]
        msgs.append({"messageId": m["MessageId"], "receiptHandle": m["ReceiptHandle"],
                     "body": body, "sentAt": m.get("Attributes", {}).get("SentTimestamp")})
    return {"messages": msgs, "count": len(msgs)}

@app.delete("/sqs/messages")
@limiter.limit("5/minute")
def purge_queue(request: Request, _user=Depends(require_jwt)):
    _sqs().purge_queue(QueueUrl=SQS_QUEUE_URL)
    return {"status": "ok", "message": "queue purged"}

@app.post("/sqs/ack")
@limiter.limit("30/minute")
def ack_message(request: Request, req: AckRequest, _user=Depends(require_jwt)):
    _sqs().delete_message(QueueUrl=SQS_QUEUE_URL, ReceiptHandle=req.receiptHandle)
    return {"status": "ok", "message": "message deleted"}

@app.get("/sqs/stats")
@limiter.limit("30/minute")
def queue_stats(request: Request, _user=Depends(require_jwt)):
    resp = _sqs().get_queue_attributes(
        QueueUrl=SQS_QUEUE_URL,
        AttributeNames=["ApproximateNumberOfMessages", "ApproximateNumberOfMessagesNotVisible", "LastModifiedTimestamp"],
    )
    a = resp.get("Attributes", {})
    return {"available": int(a.get("ApproximateNumberOfMessages", 0)),
            "inFlight":  int(a.get("ApproximateNumberOfMessagesNotVisible", 0)),
            "lastModified": a.get("LastModifiedTimestamp"), "queueUrl": SQS_QUEUE_URL}

@app.get("/sqs/email-log")
@limiter.limit("30/minute")
def email_log(request: Request, _user=Depends(require_jwt)):
    try:
        table = _dynamo().Table(DYNAMO_TABLE)
        resp  = table.query(KeyConditionExpression=DynamoKey("logType").eq("EMAIL"),
                            ScanIndexForward=False, Limit=100)
        emails = []
        for item in resp.get("Items", []):
            try: body = json.loads(item.get("body", "{}"))
            except Exception: body = {}
            emails.append({"sentAt": item.get("sentAt"), "subject": item.get("subject"),
                            "recipient": item.get("recipient"), "body": body})
        return {"emails": emails, "count": len(emails), "source": "dynamodb"}
    except Exception:
        with _log_lock:
            return {"emails": list(_email_log), "count": len(_email_log), "source": "memory"}

@app.get("/sqs/dlq")
@limiter.limit("30/minute")
def dlq_messages(request: Request, max: int = Query(10, le=10), _user=Depends(require_jwt)):
    resp = _sqs().receive_message(
        QueueUrl=DLQ_QUEUE_URL, MaxNumberOfMessages=max,
        WaitTimeSeconds=1, MessageAttributeNames=["All"], AttributeNames=["All"], VisibilityTimeout=0,
    )
    msgs = []
    for m in resp.get("Messages", []):
        try: body = json.loads(m["Body"])
        except Exception: body = m["Body"]
        msgs.append({"messageId": m["MessageId"], "body": body,
                     "sentAt": m.get("Attributes", {}).get("SentTimestamp"),
                     "receiveCount": m.get("Attributes", {}).get("ApproximateReceiveCount")})
    return {"messages": msgs, "count": len(msgs), "queueUrl": DLQ_QUEUE_URL}

@app.get("/sqs/dlq/stats")
@limiter.limit("30/minute")
def dlq_stats(request: Request, _user=Depends(require_jwt)):
    resp = _sqs().get_queue_attributes(
        QueueUrl=DLQ_QUEUE_URL,
        AttributeNames=["ApproximateNumberOfMessages", "ApproximateNumberOfMessagesNotVisible"],
    )
    a = resp.get("Attributes", {})
    return {"available": int(a.get("ApproximateNumberOfMessages", 0)),
            "inFlight":  int(a.get("ApproximateNumberOfMessagesNotVisible", 0)),
            "queueUrl": DLQ_QUEUE_URL}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=4013)
