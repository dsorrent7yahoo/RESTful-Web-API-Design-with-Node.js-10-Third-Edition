"""upload_app/views.py — /upload and /upload/file endpoints."""
from rest_framework.decorators import api_view
from rest_framework.response import Response
from utils.jwt_utils import jwt_required
from tools.dynamo_uploader import DynamoUploader, UploadCancelledError

_uploader = DynamoUploader()


def _run_upload(table_name, csv_content, csv_path, source_label,
                replace_existing, key_attr_name, key_attr_type, batch_size):
    if not replace_existing and _uploader.table_exists(table_name):
        return Response({
            "status": "confirm_required",
            "message": f"Table '{table_name}' already exists. Set replaceExistingTable=true to delete and re-upload.",
            "tableName": table_name,
            "requiresConfirmation": True,
        }, status=409)
    try:
        result = _uploader.upload(
            table_name=table_name,
            csv_path=csv_path or None,
            csv_content=csv_content or None,
            source_label=source_label,
            on_table_exists=lambda _: replace_existing,
            batch_size=batch_size,
            key_attribute_name=key_attr_name,
            key_attribute_type=key_attr_type,
        )
    except UploadCancelledError as exc:
        return Response({"status": "confirm_required", "message": str(exc),
                         "tableName": table_name, "requiresConfirmation": True}, status=409)
    except FileNotFoundError as exc:
        return Response({"status": "error", "message": "CSV file not found",
                         "csvPath": str(getattr(exc, "filename", csv_path) or "")}, status=400)
    except Exception as exc:
        return Response({"status": "error", "message": str(exc)}, status=500)
    return Response({"status": "ok",
                     "message": f"Imported {result['imported']} rows into '{result['tableName']}'",
                     **result})


@api_view(["POST"])
@jwt_required
def upload_csv(request):
    payload = dict(request.data or {})
    uploaded_file = request.FILES.get("csvFile")
    table_name = str(payload.get("tableName", "")).strip()
    if not table_name:
        return Response({"status": "error", "message": "tableName is required"}, status=400)
    replace_existing = payload.get("replaceExistingTable") in (True, "true", "1", 1)
    key_attr_name = str(payload.get("keyAttributeName") or "id").strip()
    key_attr_type = str(payload.get("keyAttributeType") or "S").strip().upper()
    batch_size = int(payload.get("batchSize") or 25)
    csv_content = payload.get("csvContent") or ""
    csv_path = payload.get("csvPath")
    source_label = payload.get("fileName") or payload.get("sourceLabel")
    if uploaded_file and not csv_content:
        csv_content = uploaded_file.read().decode("utf-8")
        source_label = source_label or uploaded_file.name
    return _run_upload(table_name, csv_content, csv_path, source_label,
                       replace_existing, key_attr_name, key_attr_type, batch_size)


@api_view(["POST"])
@jwt_required
def upload_csv_file(request):
    table_name = str(request.data.get("tableName", "")).strip()
    if not table_name:
        return Response({"status": "error", "message": "tableName is required"}, status=400)
    uploaded_file = request.FILES.get("csvFile")
    if not uploaded_file:
        return Response({"status": "error", "message": "csvFile is required"}, status=400)
    replace_existing = request.data.get("replaceExistingTable") in ("true", "1", True)
    key_attr_name = str(request.data.get("keyAttributeName") or "id").strip()
    key_attr_type = str(request.data.get("keyAttributeType") or "S").strip().upper()
    batch_size = int(request.data.get("batchSize") or 25)
    csv_content = uploaded_file.read().decode("utf-8")
    source_label = uploaded_file.name
    return _run_upload(table_name, csv_content, None, source_label,
                       replace_existing, key_attr_name, key_attr_type, batch_size)
