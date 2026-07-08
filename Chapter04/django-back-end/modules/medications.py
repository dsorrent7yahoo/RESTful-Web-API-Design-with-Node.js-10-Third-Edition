# Databricks notebook source
import csv
import io
import json
import os
from pathlib import Path

from boto3.dynamodb.conditions import Attr
from botocore.exceptions import BotoCoreError, ClientError

from model import medication as model


BASE_DIR = Path(__file__).resolve().parent.parent
CSV_PATH = Path(
    os.getenv(
        "CSV_PATH",
        str(
            BASE_DIR.parent / "coherent-11-07-2022" / "csv" / "medications.csv"
        ),
    )
).resolve()
BATCH_SIZE = 25
PATIENTS_TABLE_NAME = os.getenv("PATIENTS_TABLE_NAME", "patients")


class ApiError(Exception):
    def __init__(self, status_code, payload):
        super().__init__(payload.get("message", "Request failed"))
        self.status_code = status_code
        self.payload = payload


def first_present_field(object_value, fields):
    if not isinstance(object_value, dict):
        return None

    for field in fields:
        value = object_value.get(field)
        if value is None:
            continue
        text = str(value).strip()
        if text:
            return text

    return None


def resolve_patient_id_from_row(row):
    return first_present_field(
        row, ["id", "Id", "ID", "patient", "patientId", "PATIENT"]
    )


def resolve_patient_name_from_row(row):
    full_name = first_present_field(
        row, ["name", "NAME", "fullName", "full_name", "fullname"]
    )
    if full_name:
        return full_name

    first_name = first_present_field(
        row, ["first", "FIRST", "firstName", "first_name"]
    )
    last_name = first_present_field(
        row, ["last", "LAST", "lastName", "last_name"]
    )
    if first_name and last_name:
        return f"{first_name} {last_name}"
    return first_name or last_name


def scan_patient_names_by_ids(patient_ids):
    patient_name_by_id = {}
    wanted_ids = {str(value) for value in patient_ids or []}
    if not wanted_ids or not model.table_exists(PATIENTS_TABLE_NAME):
        return patient_name_by_id

    table = model.get_table(PATIENTS_TABLE_NAME)
    items = scan_all(table)

    for item in items:
        patient_id = resolve_patient_id_from_row(item)
        if (
            not patient_id
            or patient_id not in wanted_ids
            or patient_id in patient_name_by_id
        ):
            continue

        patient_name = resolve_patient_name_from_row(item)
        if patient_name:
            patient_name_by_id[patient_id] = patient_name

    return patient_name_by_id


def to_nullable_number(value):
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def looks_like_medication_row(row):
    return bool(
        row
        and (
            row.get("PATIENT")
            or row.get("ENCOUNTER")
            or row.get("CODE")
            or row.get("DESCRIPTION")
            or row.get("BASE_COST")
        )
    )


def to_generic_csv_item(row, row_index):
    item = {}

    for key, raw_value in (row or {}).items():
        normalized_key = str(key or "").strip().lower()
        if not normalized_key:
            continue

        if raw_value is None:
            item[normalized_key] = None
            continue

        text = str(raw_value).strip()
        if not text:
            item[normalized_key] = None
        else:
            try:
                item[normalized_key] = (
                    float(text) if "." in text else int(text)
                )
            except ValueError:
                item[normalized_key] = text

    if not item.get("id"):
        seed = "-".join(
            str(item[key])
            for key in list(item.keys())[:3]
            if item.get(key) is not None
        )
        item["id"] = f"{seed or 'row'}-{row_index}"

    return item


def to_csv_item(row, row_index):
    if not looks_like_medication_row(row):
        return to_generic_csv_item(row, row_index)

    start_part = str(row.get("START") or "nostart")
    stop_part = str(row.get("STOP") or "nostop")
    item_id = (
        f"{row.get('PATIENT') or 'patient'}"
        f"-{row.get('ENCOUNTER') or 'encounter'}"
        f"-{row.get('CODE') or 'code'}"
        f"-{start_part}-{stop_part}-{row_index}"
    )

    return {
        "id": item_id,
        "start": (
            model._to_iso8601(row.get("START")) if row.get("START") else None
        ),
        "stop": (
            model._to_iso8601(row.get("STOP")) if row.get("STOP") else None
        ),
        "patient": row.get("PATIENT"),
        "payer": row.get("PAYER"),
        "encounter": row.get("ENCOUNTER"),
        "code": row.get("CODE"),
        "description": row.get("DESCRIPTION"),
        "baseCost": to_nullable_number(row.get("BASE_COST")),
        "payerCoverage": to_nullable_number(row.get("PAYER_COVERAGE")),
        "dispenses": to_nullable_number(row.get("DISPENSES")),
        "totalCost": to_nullable_number(row.get("TOTALCOST")),
        "reasonCode": row.get("REASONCODE"),
        "reasonDescription": row.get("REASONDESCRIPTION"),
    }


def scan_all(table, **scan_kwargs):
    items = []
    last_evaluated_key = None

    while True:
        page_kwargs = dict(scan_kwargs)
        if last_evaluated_key:
            page_kwargs["ExclusiveStartKey"] = last_evaluated_key

        page = table.scan(**page_kwargs)
        items.extend(page.get("Items", []))
        last_evaluated_key = page.get("LastEvaluatedKey")
        if not last_evaluated_key:
            return items


def write_batch(items, target_table_name=None):
    resolved_table_name = target_table_name or model.table_name
    table = model.get_table(resolved_table_name)
    with table.batch_writer() as batch:
        for item in items:
            batch.put_item(Item=item)


def read_csv_rows(csv_path):
    items = []
    with open(csv_path, "r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        for row_index, row in enumerate(reader):
            items.append(to_csv_item(row, row_index))
    return items


def read_csv_rows_from_content(csv_content):
    items = []
    reader = csv.DictReader(io.StringIO(csv_content))
    for row_index, row in enumerate(reader):
        items.append(to_csv_item(row, row_index))
    return items


def import_rows_to_dynamo(items, source_label, target_table_name=None):
    resolved_table_name = target_table_name or model.table_name
    model.ensure_table_exists(resolved_table_name)

    for start in range(0, len(items), BATCH_SIZE):
        write_batch(items[start:start + BATCH_SIZE], resolved_table_name)

    return {
        "imported": len(items),
        "source": source_label,
        "tableName": resolved_table_name,
    }


def import_csv_to_dynamo(csv_path, target_table_name=None):
    items = read_csv_rows(csv_path)
    return import_rows_to_dynamo(items, str(csv_path), target_table_name)


def import_csv_content_to_dynamo(
    csv_content, source_label, target_table_name=None
):
    items = read_csv_rows_from_content(csv_content)
    return import_rows_to_dynamo(
        items,
        source_label or "uploaded-content",
        target_table_name,
    )


def find_all_medications(args):
    model.ensure_table_exists()
    top_n = int(args.get("topN", "0") or 0)
    limit_param = int(args.get("limit", "0") or 0)
    sort_order = (args.get("sort") or "").lower().strip()

    table = model.get_table()

    filters = []
    if args.get("id"):
        filters.append(Attr("id").eq(args["id"]))
    if args.get("patientId"):
        filters.append(Attr("patient").eq(args["patientId"]))
    if args.get("medicationId"):
        filters.append(Attr("code").eq(args["medicationId"]))

    filter_expression = None
    if filters:
        filter_expression = filters[0]
        for f in filters[1:]:
            filter_expression = filter_expression & f

    # When a sort is requested, fetch up to scanLimit rows then sort in-memory.
    # scanLimit (default 5 000) caps total fetched rows so the response is fast.
    if sort_order in ("asc", "desc"):
        scan_limit = int(args.get("scanLimit", "0") or 0)
        if scan_limit <= 0:
            scan_limit = 5000
        items = []
        last_key = None
        page_size = min(1000, scan_limit)
        while len(items) < scan_limit:
            page_kwargs = {"Limit": min(page_size, scan_limit - len(items))}
            if filter_expression is not None:
                page_kwargs["FilterExpression"] = filter_expression
            if last_key:
                page_kwargs["ExclusiveStartKey"] = last_key
            page = table.scan(**page_kwargs)
            items.extend(page.get("Items", []))
            last_key = page.get("LastEvaluatedKey")
            if not last_key:
                break
        reverse = sort_order == "desc"
        items.sort(key=lambda row: (row.get("description") or "").lower(), reverse=reverse)
        if top_n > 0:
            items = items[:top_n]
        return {"items": items, "lastEvaluatedKey": last_key, "total": len(items), "scanned": len(items)}

    # Default paged scan (no sort)
    limit = top_n if top_n > 0 else (limit_param if limit_param > 0 else 50)
    start_key = json.loads(args["startKey"]) if args.get("startKey") else None
    scan_kwargs = {"Limit": limit}
    if start_key:
        scan_kwargs["ExclusiveStartKey"] = start_key
    if filter_expression is not None:
        scan_kwargs["FilterExpression"] = filter_expression

    result = table.scan(**scan_kwargs)
    return {
        "items": result.get("Items", []),
        "lastEvaluatedKey": result.get("LastEvaluatedKey"),
    }


def find_medication_by_id(item_id):
    model.ensure_table_exists()
    result = model.get_table().get_item(Key={"id": item_id})
    return result.get("Item")


def find_medications_by_patient(patient):
    model.ensure_table_exists()
    result = model.get_table().scan(
        FilterExpression=Attr("patient").eq(patient)
    )
    return result.get("Items", [])


def find_medications_by_code(code):
    model.ensure_table_exists()
    result = model.get_table().scan(FilterExpression=Attr("code").eq(code))
    return result.get("Items", [])


def find_medications_by_medication_id(medication_id):
    return find_medications_by_code(medication_id)


def find_patients_with_multiple_medications(args):
    model.ensure_table_exists()
    top_n = int(args.get("topN", "0") or 0)
    items = scan_all(
        model.get_table(),
        ProjectionExpression="#patient, #code, #description",
        ExpressionAttributeNames={
            "#patient": "patient",
            "#code": "code",
            "#description": "description",
        },
    )

    patients_map = {}
    for item in items:
        patient = item.get("patient")
        if not patient:
            continue

        medication_id = (
            str(item.get("code")) if item.get("code") is not None else None
        )
        patient_medications = patients_map.setdefault(patient, {})
        if medication_id:
            entry = patient_medications.setdefault(
                medication_id,
                {
                    "medicationId": medication_id,
                    "medicationName": item.get("description"),
                    "count": 0,
                },
            )
            entry["count"] += 1
            if not entry.get("medicationName") and item.get("description"):
                entry["medicationName"] = item.get("description")

    patient_name_by_id = scan_patient_names_by_ids(patients_map.keys())
    results = [
        {
            "patientId": patient_id,
            "patientName": patient_name_by_id.get(str(patient_id)),
            "medicationCount": len(medications_map),
            "medications": sorted(
                medications_map.values(),
                key=lambda row: row["count"],
                reverse=True,
            ),
        }
        for patient_id, medications_map in patients_map.items()
        if len(medications_map) > 1
    ]
    results.sort(key=lambda row: row["medicationCount"], reverse=True)

    if top_n > 0:
        results = results[:top_n]

    return {"totalPatients": len(results), "items": results}


def save_medication(body):
    model.ensure_table_exists()
    item = model.to_medication(body)
    model.get_table().put_item(Item=item)
    return item


def update_medication(item_id, body):
    model.ensure_table_exists()
    table = model.get_table()
    existing = table.get_item(Key={"id": item_id}).get("Item")
    if not existing:
        return None

    updated = dict(existing)
    updated.update(model.to_medication(body))
    updated["id"] = item_id
    table.put_item(Item=updated)
    return updated


def remove_medication(item_id):
    model.ensure_table_exists()
    result = model.get_table().delete_item(
        Key={"id": item_id},
        ReturnValues="ALL_OLD",
    )
    return bool(result.get("Attributes"))


def upload_to_dynamo(payload, uploaded_file=None):
    requested_table_name = str(payload.get("tableName", "")).strip()
    target_table_name = requested_table_name or model.table_name
    raw_replace_existing_table = payload.get("replaceExistingTable")
    replace_existing_table = raw_replace_existing_table in (
        True,
        "true",
        "1",
        1,
    )
    csv_content = (
        payload.get("csvContent")
        if isinstance(payload.get("csvContent"), str)
        else ""
    )
    provided_csv_path = payload.get("csvPath")

    if uploaded_file is not None and not csv_content:
        csv_content = uploaded_file.read().decode("utf-8")
        payload["fileName"] = uploaded_file.filename

    if provided_csv_path and not Path(str(provided_csv_path)).is_absolute():
        raise ApiError(
            400,
            {
                "status": "error",
                "message": "csvPath must be an absolute path",
                "csvPath": provided_csv_path,
            },
        )

    target_exists = model.table_exists(target_table_name)
    if target_exists and not replace_existing_table:
        raise ApiError(
            409,
            {
                "status": "confirm_required",
                "message": (
                    f"Table {target_table_name} already exists. "
                    "Confirm replacement to delete and re-upload."
                ),
                "tableName": target_table_name,
                "requiresConfirmation": True,
            },
        )

    if target_exists and replace_existing_table:
        model.recreate_table(target_table_name)

    try:
        if csv_content:
            source_label = str(payload.get("fileName") or "uploaded-content")
            result = import_csv_content_to_dynamo(
                csv_content,
                source_label,
                target_table_name,
            )
        else:
            csv_path = (
                Path(str(provided_csv_path)).resolve()
                if provided_csv_path
                else CSV_PATH
            )
            if not csv_path.exists():
                raise ApiError(
                    400,
                    {
                        "status": "error",
                        "message": "CSV file not found",
                        "csvPath": str(csv_path),
                    },
                )
            result = import_csv_to_dynamo(csv_path, target_table_name)
    except ApiError:
        raise
    except FileNotFoundError as error:
        raise ApiError(
            400,
            {
                "status": "error",
                "message": "CSV file not found",
                "csvPath": str(error.filename or ""),
            },
        ) from error
    except (BotoCoreError, ClientError) as error:
        error_name = (
            getattr(error, "response", {}).get("Error", {}).get("Code")
            or error.__class__.__name__
        )
        if error_name in {
            "AccessDeniedException",
            "UnrecognizedClientException",
            "CredentialsProviderError",
            "NoCredentialsError",
            "InvalidSignatureException",
        }:
            raise ApiError(
                403,
                {
                    "status": "error",
                    "message": (
                        "AWS authentication/authorization failed for DynamoDB"
                    ),
                    "awsError": error_name,
                },
            ) from error
        raise

    return {
        "status": "success",
        "message": "CSV imported into DynamoDB",
        "imported": result["imported"],
        "source": result["source"],
        "tableName": result["tableName"],
    }
