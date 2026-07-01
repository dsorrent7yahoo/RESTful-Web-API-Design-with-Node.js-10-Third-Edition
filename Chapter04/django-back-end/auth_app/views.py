# Databricks notebook source
"""
auth_app/views.py
Django REST Framework views for all /auth/* endpoints.
"""
from rest_framework.decorators import api_view, throttle_classes
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle

from utils.jwt_utils import jwt_required


class LoginRateThrottle(AnonRateThrottle):
    scope = "login"


class RegisterRateThrottle(AnonRateThrottle):
    scope = "register"


@api_view(["POST"])
@throttle_classes([RegisterRateThrottle])
def register_user(request):
    from modules import auth
    body = request.data or {}
    try:
        result = auth.register_user(body, request.build_absolute_uri("/"))
        return Response(result, status=202)
    except auth.ApiError as exc:
        return Response(exc.payload, status=exc.status_code)


@api_view(["POST"])
@throttle_classes([LoginRateThrottle])
def login_user(request):
    from modules import auth
    body = request.data or {}
    try:
        result = auth.login_user(body)
        return Response(result)
    except auth.ApiError as exc:
        return Response(exc.payload, status=exc.status_code)


@api_view(["POST"])
def forgot_password(request):
    from modules import auth
    body = request.data or {}
    try:
        result = auth.reset_password_by_email(body)
        return Response(result)
    except auth.ApiError as exc:
        return Response(exc.payload, status=exc.status_code)


@api_view(["GET", "POST"])
def approve_user_registration(request):
    from modules import auth
    if request.method == "POST":
        body = request.data or {}
        token = body.get("token")
    else:
        token = request.query_params.get("token", "")
    try:
        result = auth.approve_user_registration(token)
        return Response(result)
    except auth.ApiError as exc:
        return Response(exc.payload, status=exc.status_code)


@api_view(["POST"])
def resend_pending_approval(request):
    from modules import auth
    body = request.data or {}
    try:
        result = auth.resend_approval(body, request.build_absolute_uri("/"))
        return Response(result)
    except auth.ApiError as exc:
        return Response(exc.payload, status=exc.status_code)


@api_view(["GET"])
@jwt_required
def auth_me(request):
    return Response({"status": "ok", "user": request.auth_user})


@api_view(["POST"])
@jwt_required
def auth_logout(request):
    from modules import auth
    try:
        token = auth.extract_bearer_token(request.headers.get("Authorization"))
        return Response(auth.logout_user(token))
    except auth.ApiError as exc:
        return Response(exc.payload, status=exc.status_code)
