"""
utils/jwt_utils.py
Provides the jwt_required decorator shared by all protected route blueprints.
"""
from functools import wraps

from flask import g, request


def jwt_required(handler):
    """Decorator that validates the Bearer JWT on incoming requests."""
    @wraps(handler)
    def wrapper(*args, **kwargs):
        from modules import auth as auth_module

        token = auth_module.extract_bearer_token(
            request.headers.get("Authorization")
        )
        user_item = auth_module.get_current_user_from_token(token)
        g.auth_user = auth_module.user_response(user_item)
        return handler(*args, **kwargs)

    return wrapper
