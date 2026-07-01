"""export_app/views.py — S3, Glue and pipeline export endpoints."""
from rest_framework.decorators import api_view
from rest_framework.response import Response
from utils.jwt_utils import jwt_required
from tools.aws_export import AwsExporter

_ex = AwsExporter()


@api_view(["GET"])
@jwt_required
def list_s3_buckets(request):
    try:
        return Response({"buckets": _ex.list_buckets(), "count": len(_ex.list_buckets())})
    except Exception as exc:
        return Response({"status": "error", "message": str(exc)}, status=500)


@api_view(["GET"])
@jwt_required
def list_bucket_objects(request, bucket):
    prefix = request.query_params.get("prefix", "")
    try:
        objects = _ex.list_objects(bucket, prefix)
        return Response({"bucket": bucket, "objects": objects, "count": len(objects)})
    except Exception as exc:
        return Response({"status": "error", "message": str(exc)}, status=500)


@api_view(["DELETE"])
@jwt_required
def delete_bucket(request, bucket):
    try:
        result = _ex.delete_bucket(bucket)
        return Response(result)
    except Exception as exc:
        return Response({"status": "error", "message": str(exc)}, status=500)


@api_view(["GET"])
@jwt_required
def download_object(request, bucket):
    key = request.query_params.get("key", "")
    try:
        data = _ex.download_object(bucket, key)
        from django.http import HttpResponse
        resp = HttpResponse(data["body"], content_type="application/octet-stream")
        resp["Content-Disposition"] = f'attachment; filename="{data.get("filename","download")}"'
        return resp
    except Exception as exc:
        return Response({"status": "error", "message": str(exc)}, status=500)


@api_view(["POST"])
@jwt_required
def export_to_s3(request):
    body = request.data or {}
    try:
        result = _ex.export_table_to_s3(
            table_name=body.get("tableName"),
            bucket=body.get("bucket"),
            prefix=body.get("prefix", "dynamodb-exports/"),
            fmt=body.get("format", "csv"),
            create_bucket=body.get("createBucket", False),
        )
        return Response(result)
    except Exception as exc:
        return Response({"status": "error", "message": str(exc)}, status=500)


@api_view(["GET"])
@jwt_required
def list_glue_databases(request):
    try:
        dbs = _ex.list_glue_databases()
        return Response({"databases": dbs, "count": len(dbs)})
    except Exception as exc:
        return Response({"status": "error", "message": str(exc)}, status=500)


@api_view(["GET"])
@jwt_required
def list_glue_tables(request, database):
    try:
        tables = _ex.list_glue_tables(database)
        return Response({"database": database, "tables": tables, "count": len(tables)})
    except Exception as exc:
        return Response({"status": "error", "message": str(exc)}, status=500)


@api_view(["POST"])
@jwt_required
def register_glue_table(request):
    body = request.data or {}
    try:
        result = _ex.register_glue_table(
            table_name=body.get("tableName"),
            s3_uri=body.get("s3Uri"),
            database=body.get("database", "healthcare"),
            fmt=body.get("format", "csv"),
        )
        return Response(result)
    except Exception as exc:
        return Response({"status": "error", "message": str(exc)}, status=500)


@api_view(["POST"])
@jwt_required
def export_pipeline_all(request):
    body = request.data or {}
    try:
        result = _ex.export_all_to_data_lake(
            bucket=body.get("bucket"),
            glue_database=body.get("glueDatabase", "healthcare_data_lake"),
            prefix=body.get("prefix", "datalake/"),
            fmt=body.get("format", "csv"),
            create_bucket=body.get("createBucket", False),
            create_database=body.get("createDatabase", True),
        )
        return Response(result)
    except Exception as exc:
        return Response({"status": "error", "message": str(exc)}, status=500)


@api_view(["POST"])
@jwt_required
def export_pipeline_from_csv(request):
    body = request.data or {}
    try:
        result = _ex.export_csv_to_data_lake(
            bucket=body.get("bucket"),
            glue_database=body.get("glueDatabase", "healthcare_data_lake"),
            prefix=body.get("prefix", "datalake/"),
            csv_dir=body.get("csvDir"),
            fmt=body.get("format", "csv"),
            create_bucket=body.get("createBucket", False),
            create_database=body.get("createDatabase", True),
        )
        return Response(result)
    except Exception as exc:
        return Response({"status": "error", "message": str(exc)}, status=500)
