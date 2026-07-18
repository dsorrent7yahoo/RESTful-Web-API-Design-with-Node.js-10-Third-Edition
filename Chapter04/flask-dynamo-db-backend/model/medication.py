import os
from datetime import datetime

import boto3
from botocore.exceptions import ClientError


table_name = os.getenv("DYNAMODB_TABLE", "medications")

resource_kwargs = {
    "region_name": os.getenv("AWS_REGION", "us-east-1"),
}

if os.getenv("AWS_ACCESS_KEY_ID") and os.getenv("AWS_SECRET_ACCESS_KEY"):
    resource_kwargs.update(
        {
            "aws_access_key_id": os.getenv("AWS_ACCESS_KEY_ID"),
            "aws_secret_access_key": os.getenv("AWS_SECRET_ACCESS_KEY"),
            "aws_session_token": os.getenv("AWS_SESSION_TOKEN"),
        }
    )

if os.getenv("DYNAMODB_ENDPOINT"):
    resource_kwargs["endpoint_url"] = os.getenv("DYNAMODB_ENDPOINT")

dynamodb = boto3.resource("dynamodb", **resource_kwargs)
dynamodb_client = dynamodb.meta.client


def get_table(target_table_name=None):
    return dynamodb.Table(target_table_name or table_name)


def _is_not_found_error(error):
    return (
        isinstance(error, ClientError)
        and error.response.get("Error", {}).get("Code")
        == "ResourceNotFoundException"
    )


def _to_float(value):
    return float(value) if value is not None else None


def ensure_table_exists(target_table_name=None):
    resolved_table_name = target_table_name or table_name

    try:
        dynamodb_client.describe_table(TableName=resolved_table_name)
        return
    except ClientError as error:
        if not _is_not_found_error(error):
            raise

    dynamodb.create_table(
        TableName=resolved_table_name,
        AttributeDefinitions=[{"AttributeName": "id", "AttributeType": "S"}],
        KeySchema=[{"AttributeName": "id", "KeyType": "HASH"}],
        BillingMode="PAY_PER_REQUEST",
    )
    waiter = dynamodb_client.get_waiter("table_exists")
    waiter.wait(TableName=resolved_table_name)


def table_exists(target_table_name=None):
    resolved_table_name = target_table_name or table_name
    try:
        dynamodb_client.describe_table(TableName=resolved_table_name)
        return True
    except ClientError as error:
        if _is_not_found_error(error):
            return False
        raise


def recreate_table(target_table_name=None):
    resolved_table_name = target_table_name or table_name
    if table_exists(resolved_table_name):
        dynamodb_client.delete_table(TableName=resolved_table_name)
        waiter = dynamodb_client.get_waiter("table_not_exists")
        waiter.wait(TableName=resolved_table_name)
    ensure_table_exists(resolved_table_name)


def list_tables():
    tables = []
    last_evaluated_table_name = None

    while True:
        scan_kwargs = {"Limit": 100}
        if last_evaluated_table_name:
            scan_kwargs["ExclusiveStartTableName"] = last_evaluated_table_name

        page = dynamodb_client.list_tables(**scan_kwargs)
        tables.extend(page.get("TableNames", []))
        last_evaluated_table_name = page.get("LastEvaluatedTableName")
        if not last_evaluated_table_name:
            return tables


def _to_iso8601(value):
    if not value:
        return None

    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    return parsed.isoformat().replace("+00:00", "Z")


def to_medication(body):
    default_id = (
        body.get("id")
        or body.get("medicationId")
        or (
            f"{body.get('patient', 'patient')}"
            f"-{body.get('encounter', 'encounter')}"
            f"-{body.get('code', 'code')}"
        )
    )

    return {
        "id": default_id,
        "start": _to_iso8601(body.get("start")) if body.get("start") else None,
        "stop": _to_iso8601(body.get("stop")) if body.get("stop") else None,
        "patient": body.get("patient"),
        "payer": body.get("payer"),
        "encounter": body.get("encounter"),
        "code": body.get("code"),
        "description": body.get("description"),
        "baseCost": _to_float(body.get("baseCost")),
        "payerCoverage": _to_float(body.get("payerCoverage")),
        "dispenses": _to_float(body.get("dispenses")),
        "totalCost": _to_float(body.get("totalCost")),
        "reasonCode": body.get("reasonCode"),
        "reasonDescription": body.get("reasonDescription"),
    }
