"""
routes/upload.py
Blueprint for the generic /upload endpoint.
Uses DynamoUploader to load any CSV into any DynamoDB table.
"""
from flask import Blueprint, g, jsonify, request

from tools.dynamo_uploader import DynamoUploader, UploadCancelledError
from utils.jwt_utils import jwt_required

upload_bp = Blueprint("upload", __name__)

_uploader = DynamoUploader()


@upload_bp.post("/upload")
@jwt_required
def upload_csv():
    """
    Generic CSV → DynamoDB uploader.

    Accepts JSON body:
        tableName           (required)
        csvPath             absolute path on server
        csvContent          raw CSV text
        fileName            label for csvContent uploads
        replaceExistingTable  boolean
        keyAttributeName    DynamoDB hash key name  (default: id)
        keyAttributeType    DynamoDB hash key type  (default: S)
        batchSize           items per batch         (default: 25)

    OR multipart/form-data:
        tableName, replaceExistingTable, keyAttributeName, keyAttributeType, batchSize
        csvFile             (binary)
    """
    # ── parse inputs ──────────────────────────────────────────────────────
    payload = {}
    if request.is_json:
        payload = request.get_json(silent=True) or {}
    else:
        payload = dict(request.form or {})

    uploaded_file = request.files.get("csvFile")

    table_name = str(payload.get("tableName", "")).strip()
    if not table_name:
        return jsonify({"status": "error", "message": "tableName is required"}), 400

    replace_existing = payload.get("replaceExistingTable") in (True, "true", "1", 1)
    key_attr_name = str(payload.get("keyAttributeName") or "id").strip()
    key_attr_type = str(payload.get("keyAttributeType") or "S").strip().upper()
    batch_size = int(payload.get("batchSize") or 25)

    csv_content = payload.get("csvContent") or ""
    csv_path = payload.get("csvPath")
    source_label = payload.get("fileName") or payload.get("sourceLabel")

    if uploaded_file and not csv_content:
        csv_content = uploaded_file.read().decode("utf-8")
        source_label = source_label or uploaded_file.filename

    # ── validate path if provided ─────────────────────────────────────────
    if csv_path and not str(csv_path).startswith(("/", "C:", "D:", "E:")):
        # rough absolute-path check on Windows/Linux
        from pathlib import Path
        if not Path(str(csv_path)).is_absolute():
            return jsonify({
                "status": "error",
                "message": "csvPath must be an absolute path",
                "csvPath": csv_path,
            }), 400

    # ── table-exists check (confirm required) ─────────────────────────────
    if not replace_existing and _uploader.table_exists(table_name):
        return jsonify({
            "status": "confirm_required",
            "message": (
                f"Table '{table_name}' already exists. "
                "Set replaceExistingTable=true to delete and re-upload."
            ),
            "tableName": table_name,
            "requiresConfirmation": True,
        }), 409

    # ── run upload ────────────────────────────────────────────────────────
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
        return jsonify({
            "status": "confirm_required",
            "message": str(exc),
            "tableName": table_name,
            "requiresConfirmation": True,
        }), 409
    except FileNotFoundError as exc:
        return jsonify({
            "status": "error",
            "message": "CSV file not found",
            "csvPath": str(getattr(exc, "filename", csv_path) or csv_path or ""),
        }), 400
    except Exception as exc:  # noqa: BLE001
        return jsonify({"status": "error", "message": str(exc)}), 500

    return jsonify({
        "status": "ok",
        "message": f"Imported {result['imported']} rows into '{result['tableName']}'",
        **result,
    })


@upload_bp.post("/upload/file")
@jwt_required
def upload_csv_file():
    """
    File-picker upload: multipart/form-data only.
    Swagger UI renders this as a native Choose File button with no dropdown.

    Form fields:
        tableName             (required) DynamoDB target table
        csvFile               (required) CSV file from file picker
        replaceExistingTable  boolean (optional, default false)
        keyAttributeName      default: id
        keyAttributeType      default: S
    """
    table_name = str(request.form.get("tableName", "")).strip()
    if not table_name:
        return jsonify({"status": "error", "message": "tableName is required"}), 400

    uploaded_file = request.files.get("csvFile")
    if not uploaded_file:
        return jsonify({"status": "error", "message": "csvFile is required"}), 400

    replace_existing = request.form.get("replaceExistingTable") in ("true", "1", True)
    key_attr_name = str(request.form.get("keyAttributeName") or "id").strip()
    key_attr_type = str(request.form.get("keyAttributeType") or "S").strip().upper()
    batch_size = int(request.form.get("batchSize") or 25)

    csv_content = uploaded_file.read().decode("utf-8")
    source_label = uploaded_file.filename

    if not replace_existing and _uploader.table_exists(table_name):
        return jsonify({
            "status": "confirm_required",
            "message": (
                f"Table '{table_name}' already exists. "
                "Set replaceExistingTable=true to delete and re-upload."
            ),
            "tableName": table_name,
            "requiresConfirmation": True,
        }), 409

    try:
        result = _uploader.upload(
            table_name=table_name,
            csv_content=csv_content,
            source_label=source_label,
            on_table_exists=lambda _: replace_existing,
            batch_size=batch_size,
            key_attribute_name=key_attr_name,
            key_attribute_type=key_attr_type,
        )
    except UploadCancelledError as exc:
        return jsonify({
            "status": "confirm_required",
            "message": str(exc),
            "tableName": table_name,
            "requiresConfirmation": True,
        }), 409
    except Exception as exc:  # noqa: BLE001
        return jsonify({"status": "error", "message": str(exc)}), 500

    return jsonify({
        "status": "ok",
        "message": f"Imported {result['imported']} rows into '{result['tableName']}'",
        **result,
    })
