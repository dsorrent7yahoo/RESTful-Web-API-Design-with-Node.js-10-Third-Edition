# Databricks notebook source
"""
core/views.py
Health check, DynamoDB table listing, OpenAPI spec, and Swagger UI.
"""
import copy
import json
import os
from pathlib import Path

from django.http import HttpResponse
from rest_framework.decorators import api_view, throttle_classes
from rest_framework.response import Response

from utils.jwt_utils import jwt_required

BASE_DIR = Path(__file__).resolve().parent.parent
_OPENAPI_PATH = BASE_DIR / "openapi.json"

_openapi_spec = None


def _load_openapi():
    global _openapi_spec
    if _openapi_spec is None and _OPENAPI_PATH.is_file():
        with open(_OPENAPI_PATH, "r", encoding="utf-8") as f:
            _openapi_spec = json.load(f)
    return _openapi_spec or {}


@api_view(["GET"])
@throttle_classes([])
def health(request):
    return Response({"status": "ok"})


@api_view(["GET"])
def index(request):
    react_index = BASE_DIR / "static" / "react" / "index.html"
    if react_index.is_file():
        return HttpResponse(react_index.read_text(encoding="utf-8"), content_type="text/html")
    return Response({"message": "Django backend is running. See /health or /api-docs."})


@api_view(["GET"])
@jwt_required
def list_tables(request):
    from model import medication as medication_model
    tables = medication_model.list_tables()
    return Response({"tables": tables, "user": request.auth_user})


@api_view(["GET"])
def serve_openapi(request):
    spec = copy.deepcopy(_load_openapi())
    host = request.get_host()
    scheme = "https" if request.is_secure() else "http"
    spec["servers"] = [{"url": f"{scheme}://{host}"}]
    return Response(spec)


@api_view(["GET"])
def api_docs(request):
    openapi_url = request.build_absolute_uri("/openapi.json")
    html = f"""<!DOCTYPE html>
<html>
<head>
  <title>API Docs</title>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" type="text/css" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" >
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"> </script>
  <script>
    SwaggerUIBundle({{
      url: "{openapi_url}",
      dom_id: '#swagger-ui',
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
      layout: "StandaloneLayout"
    }})
  </script>
</body>
</html>"""
    return HttpResponse(html, content_type="text/html; charset=utf-8")
