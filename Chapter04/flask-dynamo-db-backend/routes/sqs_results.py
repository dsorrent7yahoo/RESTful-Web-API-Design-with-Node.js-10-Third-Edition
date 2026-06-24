import json
import logging
import os
import threading
import time
from datetime import datetime, timezone

import boto3
from boto3.dynamodb.conditions import Key as DynamoKey
from flask import Blueprint, jsonify, request

from utils.jwt_utils import jwt_required

log = logging.getLogger(__name__)

sqs_bp = Blueprint("sqs", __name__)

REGION        = os.getenv("AWS_REGION",      "us-east-1")
SQS_QUEUE_URL = os.getenv("SQS_QUEUE_URL",
    "https://sqs.us-east-1.amazonaws.com/005905648819/dgs-fhir-lambda-results")
SES_SENDER    = os.getenv("SES_SENDER",    "dgsaws@yahoo.com")
SES_RECIPIENT = os.getenv("SES_RECIPIENT", "dsorrent7@gmail.com")
SES_RECIPIENT_NAME = "Dan Sorrentino"
POLL_INTERVAL = int(os.getenv("SQS_POLL_INTERVAL", "5"))
DLQ_QUEUE_URL = os.getenv("DLQ_QUEUE_URL",
    "https://sqs.us-east-1.amazonaws.com/005905648819/dgs-fhir-lambda-results-dlq")
DYNAMO_TABLE  = os.getenv("DYNAMO_EMAIL_LOG_TABLE", "dgs-sqs-email-log")

_email_log = []
_log_lock  = threading.Lock()


def _sqs():
    return boto3.client("sqs", region_name=REGION)


def _ses():
    return boto3.client("ses", region_name=REGION)


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
    return f"{n / (1024*1024):.2f} MB"


def _html_body(body: dict) -> str:
    ts       = body.get("timestamp", "-")
    rows     = body.get("rows_written") or str(body.get("quality_report", {}).get("clean_rows", "-"))
    missing  = body.get("rows_missing_date") or str(body.get("quality_report", {}).get("dropped_missing_date", "-"))
    key      = body.get("key", "-")
    filename = body.get("filename") or key.split("/")[-1]
    bucket   = body.get("bucket", "-")
    lname    = body.get("lambda", "unknown")
    size     = _fmt_bytes(body.get("size_bytes"))
    return f"""<html><body style="font-family:Arial,sans-serif;color:#222;max-width:580px">
<h2 style="color:#0f4c81;margin-bottom:4px">FHIR Lambda Result</h2>
<p style="color:#555;margin-top:0">
  Hi <strong>{SES_RECIPIENT_NAME}</strong>, a lambda has completed and written a new claims file.
</p>
<table cellpadding="10" cellspacing="0" border="1"
       style="border-collapse:collapse;width:100%;font-size:14px">
  <tr>
    <th style="background:#0f4c81;color:#fff;text-align:left">Field</th>
    <th style="background:#0f4c81;color:#fff;text-align:left">Value</th>
  </tr>
  <tr><td style="background:#f0f6ff"><strong>Lambda</strong></td><td>{lname}</td></tr>
  <tr><td style="background:#f0f6ff"><strong>File name</strong></td><td>{filename}</td></tr>
  <tr><td style="background:#f0f6ff"><strong>S3 location</strong></td>
      <td>s3://{bucket}/{key}</td></tr>
  <tr><td style="background:#f0f6ff"><strong>File size</strong></td><td>{size}</td></tr>
  <tr><td style="background:#f0f6ff"><strong>Rows written</strong></td><td>{rows}</td></tr>
  <tr><td style="background:#f0f6ff"><strong>Rows missing date</strong></td><td>{missing}</td></tr>
  <tr><td style="background:#f0f6ff"><strong>Date</strong></td><td>{ts}</td></tr>
</table>
<p style="color:#888;font-size:11px;margin-top:16px">
  Sent automatically by the FHIR Fargate app &mdash; dgs-fhir-lambda-results SQS queue
</p>
</body></html>"""


def _send_email(body: dict):
    filename = body.get("filename") or (body.get("key", "").split("/")[-1])
    size     = _fmt_bytes(body.get("size_bytes"))
    subject  = (
        f"[FHIR Lambda] {body.get("lambda", "result")} | "
        f"{filename} | {body.get("rows_written") or body.get("quality_report", {}).get("clean_rows", "?")} rows | {size}"
    )
    _ses().send_email(
        Source=SES_SENDER,
        Destination={"ToAddresses": [SES_RECIPIENT]},
        Message={
            "Subject": {"Data": subject, "Charset": "UTF-8"},
            "Body": {
                "Html": {"Data": _html_body(body), "Charset": "UTF-8"},
                "Text": {"Data": json.dumps(body, indent=2), "Charset": "UTF-8"},
            },
        },
    )
    entry = {
        "sentAt":    datetime.now(timezone.utc).isoformat(),
        "subject":   subject,
        "recipient": SES_RECIPIENT,
        "recipientName": SES_RECIPIENT_NAME,
        "body":      body,
    }
    with _log_lock:
        _email_log.insert(0, entry)
        if len(_email_log) > 100:
            _email_log.pop()
    try:
        _dynamo().Table(DYNAMO_TABLE).put_item(Item={
            "logType":       "EMAIL",
            "sentAt":        entry["sentAt"],
            "subject":       entry["subject"],
            "recipient":     entry["recipient"],
            "recipientName": entry["recipientName"],
            "body":          json.dumps(entry["body"]),
        })
    except Exception as exc:
        log.error("[sqs-poller] DynamoDB put error: %s", exc)
    log.info("[sqs-poller] email sent to %s: %s", SES_RECIPIENT, subject)


def _poll_loop():
    log.info("[sqs-poller] starting - interval=%ds", POLL_INTERVAL)
    while True:
        try:
            resp = _sqs().receive_message(
                QueueUrl=SQS_QUEUE_URL,
                MaxNumberOfMessages=10,
                WaitTimeSeconds=5,
                MessageAttributeNames=["All"],
            )
            for msg in resp.get("Messages", []):
                try:
                    body = json.loads(msg["Body"])
                except Exception:
                    body = {"raw": msg["Body"]}
                try:
                    _send_email(body)
                except Exception as exc:
                    log.error("[sqs-poller] SES error: %s", exc)
                _sqs().delete_message(
                    QueueUrl=SQS_QUEUE_URL,
                    ReceiptHandle=msg["ReceiptHandle"],
                )
        except Exception as exc:
            log.error("[sqs-poller] SQS error: %s", exc)
        time.sleep(POLL_INTERVAL)


def start_poller():
    t = threading.Thread(target=_poll_loop, daemon=True, name="sqs-email-poller")
    t.start()
    log.info("[sqs-poller] daemon thread started")


@sqs_bp.get("/sqs/messages")
@jwt_required
def receive_messages():
    max_msgs = min(int(request.args.get("max", 10)), 10)
    resp = _sqs().receive_message(
        QueueUrl=SQS_QUEUE_URL,
        MaxNumberOfMessages=max_msgs,
        WaitTimeSeconds=1,
        MessageAttributeNames=["All"],
        AttributeNames=["All"],
    )
    messages = []
    for m in resp.get("Messages", []):
        try:
            body = json.loads(m["Body"])
        except Exception:
            body = m["Body"]
        messages.append({
            "messageId":     m["MessageId"],
            "receiptHandle": m["ReceiptHandle"],
            "body":          body,
            "sentAt":        m.get("Attributes", {}).get("SentTimestamp"),
        })
    return jsonify({"messages": messages, "count": len(messages)})


@sqs_bp.post("/sqs/ack")
@jwt_required
def ack_message():
    data   = request.get_json(force=True) or {}
    handle = data.get("receiptHandle", "").strip()
    if not handle:
        return jsonify({"status": "error", "message": "receiptHandle required"}), 400
    _sqs().delete_message(QueueUrl=SQS_QUEUE_URL, ReceiptHandle=handle)
    return jsonify({"status": "ok"})


@sqs_bp.delete("/sqs/messages")
@jwt_required
def purge_messages():
    _sqs().purge_queue(QueueUrl=SQS_QUEUE_URL)
    return jsonify({"status": "ok", "message": "queue purged"})


@sqs_bp.get("/sqs/stats")
@jwt_required
def queue_stats():
    resp = _sqs().get_queue_attributes(
        QueueUrl=SQS_QUEUE_URL,
        AttributeNames=[
            "ApproximateNumberOfMessages",
            "ApproximateNumberOfMessagesNotVisible",
            "LastModifiedTimestamp",
        ],
    )
    attrs = resp.get("Attributes", {})
    return jsonify({
        "available":    int(attrs.get("ApproximateNumberOfMessages",          0)),
        "inFlight":     int(attrs.get("ApproximateNumberOfMessagesNotVisible", 0)),
        "lastModified": attrs.get("LastModifiedTimestamp"),
        "queueUrl":     SQS_QUEUE_URL,
    })


@sqs_bp.get("/sqs/email-log")
@jwt_required
def email_log():
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
        return jsonify({"emails": emails, "count": len(emails), "source": "dynamodb"})
    except Exception as exc:
        log.error("[email-log] DynamoDB query error: %s", exc)
        with _log_lock:
            return jsonify({"emails": list(_email_log), "count": len(_email_log), "source": "memory"})

@sqs_bp.get("/sqs/dlq")
@jwt_required
def dlq_messages():
    """Peek at DLQ messages without deleting them (VisibilityTimeout=0)."""
    max_msgs = min(int(request.args.get("max", 10)), 10)
    resp = _sqs().receive_message(
        QueueUrl=DLQ_QUEUE_URL,
        MaxNumberOfMessages=max_msgs,
        WaitTimeSeconds=1,
        MessageAttributeNames=["All"],
        AttributeNames=["All"],
        VisibilityTimeout=0,
    )
    messages = []
    for m in resp.get("Messages", []):
        try:
            body = json.loads(m["Body"])
        except Exception:
            body = m["Body"]
        messages.append({
            "messageId":    m["MessageId"],
            "body":         body,
            "sentAt":       m.get("Attributes", {}).get("SentTimestamp"),
            "receiveCount": m.get("Attributes", {}).get("ApproximateReceiveCount"),
        })
    return jsonify({"messages": messages, "count": len(messages), "queueUrl": DLQ_QUEUE_URL})


@sqs_bp.get("/sqs/dlq/stats")
@jwt_required
def dlq_stats():
    resp = _sqs().get_queue_attributes(
        QueueUrl=DLQ_QUEUE_URL,
        AttributeNames=["ApproximateNumberOfMessages", "ApproximateNumberOfMessagesNotVisible"],
    )
    attrs = resp.get("Attributes", {})
    return jsonify({
        "available": int(attrs.get("ApproximateNumberOfMessages", 0)),
        "inFlight":  int(attrs.get("ApproximateNumberOfMessagesNotVisible", 0)),
        "queueUrl":  DLQ_QUEUE_URL,
    })
