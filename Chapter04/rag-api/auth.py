"""
auth.py — JWT authentication dependency for FastAPI.

PURPOSE
-------
Verifies that every protected API request carries a valid Bearer token.
The token is a JSON Web Token (JWT) — a compact, signed string that encodes
the user's identity and role without a database lookup on every request.

JWT BASICS
----------
A JWT looks like:  eyJhbGci....header.payload.signature
The header declares the algorithm (HS256 = HMAC-SHA256).
The payload carries claims: sub (user ID), role (admin / user), exp (expiry).
The signature is created with the JWT_SECRET env var and verifies the token
has not been tampered with.

HOW IT IS USED
--------------
FastAPI routes declare `_: dict = Depends(require_jwt)` in their signature.
FastAPI automatically calls require_jwt before the route handler, raising HTTP 401
if the token is missing, expired, or invalid.

The same JWT_SECRET must be used by the Flask backend (POST /login) that
issued the token, and by this FastAPI service that validates it.

FUNCTIONS
---------
require_jwt(credentials: HTTPAuthorizationCredentials) -> dict
    FastAPI dependency.  Extracts the Bearer token from the Authorization header,
    decodes it using JWT_SECRET, and returns the decoded payload dict.
    Raises HTTPException 401 if token is missing, expired, or tampered with.

OPEN ENDPOINTS (no auth required)
----------------------------------
GET /health             — service liveness check
GET /rag/index/status   — corpus document counts
GET /rag/jobs/{job_id}  — background job progress
"""

import jwt as pyjwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from config import settings

_bearer = HTTPBearer(auto_error=True)

def require_jwt(credentials: HTTPAuthorizationCredentials = Depends(_bearer)) -> dict:
    token = credentials.credentials
    try:
        return pyjwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    except pyjwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token has expired",
                            headers={"WWW-Authenticate": "Bearer"})
    except pyjwt.InvalidTokenError as exc:
        raise HTTPException(status_code=401, detail=f"Invalid token: {exc}",
                            headers={"WWW-Authenticate": "Bearer"})
