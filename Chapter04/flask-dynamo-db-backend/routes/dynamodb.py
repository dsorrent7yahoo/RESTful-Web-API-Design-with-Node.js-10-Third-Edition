"""
routes/dynamodb.py
Blueprint for DynamoDB table listing, OpenAPI spec serving, and Swagger UI.
"""
import copy
import json

from flask import Blueprint, g, jsonify, request

from utils.jwt_utils import jwt_required
from utils.openapi import build_openapi_servers, build_swagger_ui_html, ensure_auth_openapi_paths, openapi_spec

dynamodb_bp = Blueprint("dynamodb", __name__)


@dynamodb_bp.route("/tables", methods=["GET"])
@jwt_required
def list_tables():
    """List all DynamoDB tables (requires JWT)."""
    from model import medication as medication_model

    tables = medication_model.list_tables()
    return jsonify({"tables": tables, "user": g.auth_user})


@dynamodb_bp.route("/openapi.json", methods=["GET"])
def serve_openapi():
    """Serve the OpenAPI spec with auth paths and current server URLs injected."""
    spec = copy.deepcopy(openapi_spec)
    spec["servers"] = build_openapi_servers()
    ensure_auth_openapi_paths(spec)
    response = jsonify(spec)
    response.headers["Content-Type"] = "application/json"
    return response


@dynamodb_bp.route("/api-docs", methods=["GET"])
def api_docs():
    """Serve the Swagger UI HTML page."""
    html = build_swagger_ui_html()
    return html, 200, {"Content-Type": "text/html; charset=utf-8"}
