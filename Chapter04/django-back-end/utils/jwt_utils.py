# Databricks notebook source
import functools
from rest_framework.response import Response
import modules.auth as auth_module


def jwt_required(fn):
    """Decorator that validates JWT and sets request.auth_user."""
    @functools.wraps(fn)
    def wrapper(request, *args, **kwargs):
        auth_header = request.META.get("HTTP_AUTHORIZATION", "")
        if not auth_header.startswith("Bearer "):
            return Response({"message": "Missing or invalid Authorization header"}, status=401)
        token = auth_header[len("Bearer "):]
        try:
            user = auth_module.verify_access_token(token)
            request.auth_user = user
        except auth_module.ApiError as exc:
            return Response(exc.payload, status=exc.status_code)
        except Exception:
            return Response({"message": "Invalid or expired token"}, status=401)
        return fn(request, *args, **kwargs)
    return wrapper
