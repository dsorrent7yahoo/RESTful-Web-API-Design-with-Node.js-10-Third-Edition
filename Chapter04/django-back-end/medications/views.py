"""
medications/views.py
Django REST Framework views for all /medications/* endpoints (JWT-protected).
"""
from rest_framework.decorators import api_view
from rest_framework.response import Response

from utils.jwt_utils import jwt_required


@api_view(["GET", "POST"])
@jwt_required
def medications_list_or_create(request):
    from modules import medications
    if request.method == "POST":
        body = request.data or {}
        item = medications.save_medication(body)
        return Response(item, status=201)
    return Response(medications.find_all_medications(request.query_params))


@api_view(["GET"])
@jwt_required
def get_medication_by_id(request, item_id):
    from modules import medications
    item = medications.find_medication_by_id(item_id)
    if item is None:
        return Response({"message": "Not Found"}, status=404)
    return Response(item)


@api_view(["GET"])
@jwt_required
def get_medications_by_patient(request, patient):
    from modules import medications
    return Response(medications.find_medications_by_patient(patient))


@api_view(["GET"])
@jwt_required
def get_medications_by_code(request, code):
    from modules import medications
    return Response(medications.find_medications_by_code(code))


@api_view(["GET"])
@jwt_required
def get_medications_by_medication_id(request, medication_id):
    from modules import medications
    return Response(medications.find_medications_by_medication_id(medication_id))


@api_view(["GET"])
@jwt_required
def get_patients_with_multiple_medications(request):
    from modules import medications
    return Response(medications.find_patients_with_multiple_medications(request.query_params))


@api_view(["PUT", "DELETE"])
@jwt_required
def medication_detail(request, item_id):
    from modules import medications
    if request.method == "DELETE":
        deleted = medications.remove_medication(item_id)
        if not deleted:
            return Response({"message": "Not Found"}, status=404)
        return Response({"Status": "Successfully deleted"})
    # PUT
    body = request.data or {}
    item = medications.update_medication(item_id, body)
    if item is None:
        return Response({"message": "Not Found"}, status=404)
    return Response(item)


@api_view(["POST"])
@jwt_required
def upload_medications(request):
    from modules import medications
    payload = dict(request.data or {})
    uploaded_file = request.FILES.get("csvFile")
    csv_content = (
        uploaded_file.read().decode("utf-8")
        if uploaded_file
        else payload.get("csvContent", "")
    )
    source_label = (
        uploaded_file.name if uploaded_file else payload.get("fileName", "upload")
    )
    result = medications.import_csv_content_to_dynamo(
        csv_content,
        source_label,
        payload.get("tableName"),
    )
    return Response(result, status=200)
