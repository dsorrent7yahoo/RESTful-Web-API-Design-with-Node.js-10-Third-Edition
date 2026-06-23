"""
routes/medications.py
Blueprint for all /medications/* routes (all JWT-protected).
"""
from flask import Blueprint, Response, g, jsonify, request

from utils.jwt_utils import jwt_required

medications_bp = Blueprint("medications", __name__)


@medications_bp.get("/medications")
@jwt_required
def get_medications():
    from modules import medications
    return jsonify(medications.find_all_medications(request.args))


@medications_bp.get("/medications/id/<string:item_id>")
@jwt_required
def get_medication_by_id(item_id):
    from modules import medications
    item = medications.find_medication_by_id(item_id)
    if item is None:
        return Response("Not Found", status=404, mimetype="text/plain")
    return jsonify(item)


@medications_bp.get("/medications/patient/<string:patient>")
@jwt_required
def get_medications_by_patient(patient):
    from modules import medications
    return jsonify(medications.find_medications_by_patient(patient))


@medications_bp.get("/medications/code/<string:code>")
@jwt_required
def get_medications_by_code(code):
    from modules import medications
    return jsonify(medications.find_medications_by_code(code))


@medications_bp.get("/medications/medication/<string:medication_id>")
@jwt_required
def get_medications_by_medication_id(medication_id):
    from modules import medications
    return jsonify(
        medications.find_medications_by_medication_id(medication_id)
    )


@medications_bp.get("/medications/patients/multiple-medications")
@jwt_required
def get_patients_with_multiple_medications():
    from modules import medications
    return jsonify(
        medications.find_patients_with_multiple_medications(request.args)
    )


@medications_bp.post("/medications")
@jwt_required
def create_medication():
    from modules import medications
    body = request.get_json(silent=True) or {}
    item = medications.save_medication(body)
    return jsonify(item), 201


@medications_bp.put("/medications/<string:item_id>")
@jwt_required
def update_medication(item_id):
    from modules import medications
    body = request.get_json(silent=True) or {}
    item = medications.update_medication(item_id, body)
    if item is None:
        return Response("Not Found", status=404, mimetype="text/plain")
    return jsonify(item)


@medications_bp.delete("/medications/<string:item_id>")
@jwt_required
def delete_medication(item_id):
    from modules import medications
    deleted = medications.remove_medication(item_id)
    if not deleted:
        return Response("Not Found", status=404, mimetype="text/plain")
    return jsonify({"Status": "Successfully deleted"})


@medications_bp.post("/medications/upload")
@jwt_required
def upload_medications():
    from modules import medications
    payload = dict(request.form or {})
    if request.is_json:
        payload.update(request.get_json(silent=True) or {})
    uploaded_file = request.files.get("csvFile")
    result = medications.upload_to_dynamo(payload, uploaded_file)
    return jsonify(result)
