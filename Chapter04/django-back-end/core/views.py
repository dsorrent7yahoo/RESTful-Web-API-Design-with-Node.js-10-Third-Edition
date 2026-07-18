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
_OPENAPI_PATH     = BASE_DIR / "openapi.json"
_RAG_OPENAPI_PATH = BASE_DIR.parent / "rag-api" / "rag-swagger" / "openapi.json"

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
    spec["servers"] = [{"url": f"{scheme}://{host}", "description": "Django backend"}]
    return Response(spec)


@api_view(["GET"])
def serve_rag_openapi(request):
    """Proxy the RAG API OpenAPI spec so Swagger UI can load it without CORS issues."""
    if not _RAG_OPENAPI_PATH.is_file():
        return Response({"error": "RAG API spec not found"}, status=404)
    with open(_RAG_OPENAPI_PATH, "r", encoding="utf-8") as f:
        spec = json.load(f)
    host = request.get_host().split(":")[0]
    spec["servers"] = [{"url": f"http://{host}:4005", "description": "Healthcare RAG API"}]
    return Response(spec)


@api_view(["GET"])
def api_docs(request):
    django_openapi_url = request.build_absolute_uri("/openapi.json")
    rag_openapi_url    = request.build_absolute_uri("/rag-openapi.json")
    html = f"""<!DOCTYPE html>
<html>
<head>
  <title>API Docs \u2014 Django &amp; RAG</title>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" type="text/css" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
  <style>
    .swagger-ui .topbar {{ background: #1b2a3b; }}
    .swagger-ui .topbar .download-url-wrapper .select-label select {{ border: 1px solid #7dd3fc; }}
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-standalone-preset.js"></script>
  <script>
    SwaggerUIBundle({{
      urls: [
        {{ url: "{django_openapi_url}", name: "\U0001f3e5 Django Medications API" }},
        {{ url: "{rag_openapi_url}",    name: "\U0001f9e0 Healthcare RAG API (ClinicalBERT \u00b7 Bedrock)" }}
      ],
      "urls.primaryName": "\U0001f3e5 Django Medications API",
      dom_id: "#swagger-ui",
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
      plugins: [SwaggerUIBundle.plugins.DownloadUrl],
      layout: "StandaloneLayout",
      persistAuthorization: true,
      tryItOutEnabled: true
    }})
  </script>
</body>
</html>"""
    return HttpResponse(html, content_type="text/html; charset=utf-8")