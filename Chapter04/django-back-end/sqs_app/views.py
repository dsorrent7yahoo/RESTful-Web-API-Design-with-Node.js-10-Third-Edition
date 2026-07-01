import json
import logging
import os
import threading

import boto3
from boto3.dynamodb.conditions import Key as DynamoKey
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods

from utils.jwt_utils import jwt_required

log = logging.getLogger(__name__)

REGION        = os.getenv("AWS_REGION", "us-east-1")
SQS_QUEUE_URL = os.getenv(
    "SQS_QUEUE_URL",
    "https://sqs.us-east-1.amazonaws.com/005905648819/dgs-fhir-lambda-results",
)
DLQ_QUEUE_URL = os.getenv(
    "DLQ_QUEUE_URL",
    "https://sqs.us-east-1.amazonaws.com/005905648819/dgs-fhir-lambda-results-dlq",
)
DYNAMO_TABLE = os.getenv("DYNAMO_EMAIL_LOG_TABLE", "dgs-sqs-email-log")

_email_log = []
_log_lock  = threading.Lock()


def _sqs():
    return boto3.client("sqs", region_name=REGION)


def _dynamo():
    return boto3.resource("dynamodb", region_name=REGION)


def _fmt_bytes(n):
    if n is None:
        return "unknown"
    n = int(n)
    if n < 1024:
        return f"{n} B"
    if n < 1024 * 1024:
        return f"{n / 1024:.1f} KB"
    return f"{n / (1024 * 1024):.2f} MB"


@jwt_required
@require_http_methods(["GET", "DELETE"])
def messages(request):
    """GET -> receive messages; DELETE -> purge queue."""
    if request.method == "DELETE":
        _sqs().purge_queue(QueueUrl=SQS_QUEUE_URL)
        return JsonResponse({"status": "ok", "message": "queue purged"})

    max_msgs = min(int(request.GET.get("max", 10)), 10)
    resp = _sqs().receive_message(
        QueueUrl=SQS_QUEUE_URL,
        MaxNumberOfMessages=max_msgs,
        WaitTimeSeconds=1,
        MessageAttributeNames=["All"],
        AttributeNames=["All"],
    )
    msgs = []
    for m in resp.get("Messages", []):
        try:
            body = json.loads(m["Body"])
        except Exception:
            body = m["Body"]
        msgs.append({
            "messageId":     m["MessageId"],
            "receiptHandle": m["ReceiptHandle"],
            "body":          body,
            "sentAt":        m.get("Attributes", {}).get("SentTimestamp"),
        })
    return JsonResponse({"messages": msgs, "count": len(msgs)})


@jwt_required
@require_http_methods(["GET"])
def queue_stats(request):
    resp = _sqs().get_queue_attributes(
        QueueUrl=SQS_QUEUE_URL,
        AttributeNames=[
            "ApproximateNumberOfMessages",
            "ApproximateNumberOfMessagesNotVisible",
            "LastModifiedTimestamp",
        ],
    )
    attrs = resp.get("Attributes", {})
    return JsonResponse({
        "available":    int(attrs.get("ApproximateNumberOfMessages", 0)),
        "inFlight":     int(attrs.get("ApproximateNumberOfMessagesNotVisible", 0)),
        "lastModified": attrs.get("LastModifiedTimestamp"),
        "queueUrl":     SQS_QUEUE_URL,
    })


@jwt_required
@require_http_methods(["GET"])
def email_log(request):
    try:
        table = _dynamo().Table(DYNAMO_TABLE)
        resp  = table.query(
            KeyConditionExpression=DynamoKey("logType").eq("EMAIL"),
            ScanIndexForward=False,
            Limit=100,
        )
        emails = []
        for item in resp.get("Items", []):
            try:
                body = json.loads(item.get("body", "{}"))
            except Exception:
                body = {}
            emails.append({
                "sentAt":        item.get("sentAt"),
                "subject":       item.get("subject"),
                "recipient":     item.get("recipient"),
                "recipientName": item.get("recipientName"),
                "body":          body,
            })
        return JsonResponse({"emails": emails, "count": len(emails), "source": "dynamodb"})
    except Exception as exc:
        log.error("[email-log] DynamoDB query error: %s", exc)
        with _log_lock:
            return JsonResponse({"emails": list(_email_log), "count": len(_email_log), "source": "memory"})


@jwt_required
@require_http_methods(["GET"])
def dlq_messages(request):
    max_msgs = min(int(request.GET.get("max", 10)), 10)
    resp = _sqs().receive_message(
        QueueUrl=DLQ_QUEUE_URL,
        MaxNumberOfMessages=max_msgs,
        WaitTimeSeconds=1,
        MessageAttributeNames=["All"],
        AttributeNames=["All"],
        VisibilityTimeout=0,
    )
    msgs = []
    for m in resp.get("Messages", []):
        try:
            body = json.loads(m["Body"])
        except Exception:
            body = m["Body"]
        msgs.append({
            "messageId":    m["MessageId"],
            "body":         body,
            "sentAt":       m.get("Attributes", {}).get("SentTimestamp"),
            "receiveCount": m.get("Attributes", {}).get("ApproximateReceiveCount"),
        })
    return JsonResponse({"messages": msgs, "count": len(msgs), "queueUrl": DLQ_QUEUE_URL})


@jwt_required
@require_http_methods(["GET"])
def dlq_stats(request):
    resp = _sqs().get_queue_attributes(
        QueueUrl=DLQ_QUEUE_URL,
        AttributeNames=["ApproximateNumberOfMessages", "ApproximateNumberOfMessagesNotVisible"],
    )
    attrs = resp.get("Attributes", {})
    return JsonResponse({
        "available": int(attrs.get("ApproximateNumberOfMessages", 0)),
        "inFlight":  int(attrs.get("ApproximateNumberOfMessagesNotVisible", 0)),
        "queueUrl":  DLQ_QUEUE_URL,
    })
