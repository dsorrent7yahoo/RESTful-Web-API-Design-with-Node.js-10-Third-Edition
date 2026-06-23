"""
routes/auth.py
Blueprint for all /auth/* routes.
"""
from flask import Blueprint, g, jsonify, request

from utils.jwt_utils import jwt_required

auth_bp = Blueprint("auth", __name__)


@auth_bp.post("/auth/register")
def register_user():
    from modules import auth
    body = request.get_json(silent=True) or {}
    result = auth.register_user(body, request.host_url)
    return jsonify(result), 202


@auth_bp.post("/auth/login")
def login_user():
    from modules import auth
    body = request.get_json(silent=True) or {}
    result = auth.login_user(body)
    return jsonify(result)


@auth_bp.post("/auth/forgot-password")
def forgot_password():
    from modules import auth
    body = request.get_json(silent=True) or {}
    result = auth.reset_password_by_email(body)
    return jsonify(result)


@auth_bp.get("/auth/approve")
def approve_user_registration_link():
    from modules import auth
    token = request.args.get("token", "")
    result = auth.approve_user_registration(token)
    return jsonify(result)


@auth_bp.post("/auth/approve")
def approve_user_registration_api():
    from modules import auth
    body = request.get_json(silent=True) or {}
    result = auth.approve_user_registration(body.get("token"))
    return jsonify(result)


@auth_bp.post("/auth/resend-approval")
def resend_pending_approval():
    from modules import auth
    body = request.get_json(silent=True) or {}
    result = auth.resend_approval(body, request.host_url)
    return jsonify(result)


@auth_bp.get("/auth/me")
@jwt_required
def auth_me():
    return jsonify({"status": "ok", "user": g.auth_user})


@auth_bp.post("/auth/logout")
@jwt_required
def auth_logout():
    from modules import auth
    token = auth.extract_bearer_token(
        request.headers.get("Authorization")
    )
    return jsonify(auth.logout_user(token))
