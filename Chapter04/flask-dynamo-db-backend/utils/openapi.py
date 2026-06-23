"""
utils/openapi.py
Loads the Flask-specific OpenAPI spec, builds Swagger UI HTML,
and injects auth paths and BearerAuth security into the spec at request time.
"""
import json
import os
import socket
from pathlib import Path
from urllib.parse import urlsplit

from flask import request


BASE_DIR = Path(__file__).resolve().parent.parent
CHAPTER_DIR = BASE_DIR.parent
OPENAPI_PATH = BASE_DIR / "openapi.json"
CSV_TABLES_DIR = CHAPTER_DIR / "coherent-11-07-2022" / "csv"
DEFAULT_CSV_PATH = Path(
    os.getenv("CSV_PATH", str(CSV_TABLES_DIR / "medications.csv"))
).resolve()


def load_openapi_spec():
    if not OPENAPI_PATH.exists():
        return {
            "openapi": "3.0.3",
            "info": {
                "title": "Flask DynamoDB Medical Records App",
                "version": "1.0.0",
            },
            "paths": {},
        }

    with OPENAPI_PATH.open("r", encoding="utf-8") as handle:
        spec = json.load(handle)

    try:
        schema = spec["paths"]["/medications/upload"]["post"][
            "requestBody"
        ]["content"]["application/json"]["schema"]
        schema["properties"]["csvPath"]["example"] = str(DEFAULT_CSV_PATH)
    except KeyError:
        pass

    return spec


def get_local_ip_addresses():
    ip_addresses = []

    try:
        for ip_address in socket.gethostbyname_ex(socket.gethostname())[2]:
            if ip_address and ip_address not in ip_addresses:
                ip_addresses.append(ip_address)
    except OSError:
        pass

    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("8.8.8.8", 80))
            outbound_ip = sock.getsockname()[0]
            if outbound_ip and outbound_ip not in ip_addresses:
                ip_addresses.append(outbound_ip)
    except OSError:
        pass

    return [
        ip_address
        for ip_address in ip_addresses
        if ip_address not in {"127.0.0.1", "0.0.0.0"}
    ]


def build_openapi_servers():
    request_url = request.host_url.rstrip("/")
    parsed_url = urlsplit(request_url)
    scheme = parsed_url.scheme or "http"
    host = parsed_url.hostname or "127.0.0.1"
    port = parsed_url.port

    candidates = [
        {"url": "/", "description": "Current host"},
        {"url": request_url, "description": f"Current request host ({host})"},
    ]

    if port:
        candidates.extend([
            {"url": f"{scheme}://127.0.0.1:{port}", "description": "Loopback (127.0.0.1)"},
            {"url": f"{scheme}://localhost:{port}", "description": "Localhost"},
        ])
        for ip_address in get_local_ip_addresses():
            candidates.append(
                {"url": f"{scheme}://{ip_address}:{port}", "description": f"LAN IP ({ip_address})"}
            )

    seen_urls = set()
    servers = []
    for server in candidates:
        url = server["url"]
        if url in seen_urls:
            continue
        seen_urls.add(url)
        servers.append(server)

    return servers


def build_swagger_ui_html():
    return """<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>Flask DynamoDB API Docs</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
    <style>
      #token-bar {
        background: #1b1b1b;
        color: #fff;
        padding: 10px 18px;
        font-family: sans-serif;
        font-size: 13px;
        display: flex;
        align-items: center;
        gap: 12px;
      }
      #token-bar a { color: #7dd3fc; text-decoration: none; }
      #token-status { opacity: 0.75; }
      #close-btn {
        margin-left: auto;
        background: #374151;
        color: #fff;
        border: 1px solid #6b7280;
        border-radius: 6px;
        padding: 4px 14px;
        cursor: pointer;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.03em;
        transition: background 120ms;
      }
      #close-btn:hover { background: #4b5563; }
    </style>
  </head>
  <body>
    <div id="token-bar">
      <strong>Flask DynamoDB API Docs</strong>
      <span id="token-status">Checking token&hellip;</span>
      <button id="close-btn" title="Return to the React UI"
        onclick="
          if (window.opener && !window.opener.closed) {
            window.opener.focus();
            window.close();
          } else if (document.referrer) {
            window.location.href = document.referrer;
          } else {
            window.location.href = window.location.hostname === 'localhost'
              ? 'http://localhost:5173/'
              : '/';
          }
        ">
        ← Back to App
      </button>
    </div>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>
      const token = localStorage.getItem('healthCareToken') || '';
      const statusEl = document.getElementById('token-status');

      if (token) {
        statusEl.textContent = 'Token found — requests will include Authorization header';
        statusEl.style.color = '#86efac';
      } else {
        statusEl.textContent = 'No token — log in first or use the Authorize button below';
        statusEl.style.color = '#fca5a5';
      }

      window.ui = SwaggerUIBundle({
        url: '/openapi.json',
        dom_id: '#swagger-ui',
        presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
        layout: 'BaseLayout',
        deepLinking: true,
        requestInterceptor: function(req) {
          const t = localStorage.getItem('healthCareToken') || '';
          if (t && !req.headers['Authorization']) {
            req.headers['Authorization'] = 'Bearer ' + t;
          }
          return req;
        },
        onComplete: function() {
          const t = localStorage.getItem('healthCareToken') || '';
          if (t) {
            window.ui.preauthorizeApiKey('BearerAuth', t);
          }

          // Auto-click "Try it out" for POST /upload/file so the file picker
          // is immediately visible without the user having to click first.
          function activateFilePicker() {
            // Swagger renders operation blocks as
            //   <div id="operations-Upload-upload_file_post"> (tag + operationId)
            // or contains data-path="/upload/file".
            // Find all "Try it out" buttons and click the one inside the upload/file block.
            const allBlocks = document.querySelectorAll('.opblock');
            for (const block of allBlocks) {
              const pathEl = block.querySelector('.opblock-summary-path');
              if (pathEl && pathEl.textContent.trim().includes('/upload/file')) {
                // Expand the block if collapsed
                const summary = block.querySelector('.opblock-summary');
                if (summary && block.classList.contains('is-collapsed')) {
                  summary.click();
                }
                // Click "Try it out"
                const tryBtn = block.querySelector('.try-out__btn');
                if (tryBtn && !tryBtn.classList.contains('cancel')) {
                  tryBtn.click();
                }
                break;
              }
            }
          }

          // Swagger UI renders asynchronously — wait a beat for the DOM to settle.
          setTimeout(activateFilePicker, 800);
        }
      });
    </script>
  </body>
</html>"""


def ensure_auth_openapi_paths(spec):
    spec.setdefault("tags", [])
    tags = {tag.get("name") for tag in spec["tags"] if isinstance(tag, dict)}
    if "Auth" not in tags:
        spec["tags"].append({"name": "Auth", "description": "User authentication and registration"})

    components = spec.setdefault("components", {})
    schemas = components.setdefault("schemas", {})
    security_schemes = components.setdefault("securitySchemes", {})
    security_schemes["BearerAuth"] = {
        "type": "http",
        "scheme": "bearer",
        "bearerFormat": "JWT",
    }

    schemas.setdefault("AuthRegisterRequest", {
        "type": "object",
        "required": ["email", "password"],
        "properties": {
            "email": {"type": "string", "example": "person@example.com"},
            "password": {"type": "string", "example": "s3cret"},
            "username": {"type": "string", "example": "person"},
        },
    })
    schemas.setdefault("AuthLoginRequest", {
        "type": "object",
        "required": ["email", "password"],
        "properties": {
            "email": {"type": "string", "example": "person@example.com"},
            "password": {"type": "string", "example": "s3cret"},
        },
    })
    schemas.setdefault("AuthForgotPasswordRequest", {
        "type": "object",
        "required": ["email", "newPassword"],
        "properties": {
            "email": {"type": "string", "example": "person@example.com"},
            "newPassword": {"type": "string", "example": "s3cret2"},
        },
    })
    schemas.setdefault("AuthUser", {
        "type": "object",
        "properties": {
            "email": {"type": "string"},
            "username": {"type": "string"},
            "createdAt": {"type": "string", "format": "date-time"},
        },
    })
    schemas.setdefault("AuthApproveRequest", {
        "type": "object",
        "required": ["token"],
        "properties": {
            "token": {"type": "string", "example": "approval-token-from-email-link"},
        },
    })

    paths = spec.setdefault("paths", {})

    paths["/auth/register"] = {"post": {
        "tags": ["Auth"], "summary": "Register a new user",
        "requestBody": {"required": True, "content": {"application/json": {
            "schema": {"$ref": "#/components/schemas/AuthRegisterRequest"}}}},
        "responses": {
            "202": {"description": "Registration request pending approval"},
            "409": {"description": "Email already registered"},
        },
    }}

    paths["/auth/approve"] = {
        "get": {
            "tags": ["Auth"], "summary": "Approve pending registration from email link",
            "parameters": [{"name": "token", "in": "query", "required": True, "schema": {"type": "string"}}],
            "responses": {"200": {"description": "Approved"}, "404": {"description": "Not found"}, "410": {"description": "Expired"}},
        },
        "post": {
            "tags": ["Auth"], "summary": "Approve pending registration by token",
            "requestBody": {"required": True, "content": {"application/json": {
                "schema": {"$ref": "#/components/schemas/AuthApproveRequest"}}}},
            "responses": {"200": {"description": "Approved"}, "404": {"description": "Not found"}, "410": {"description": "Expired"}},
        },
    }

    paths["/auth/resend-approval"] = {"post": {
        "tags": ["Auth"], "summary": "Resend approval email for a pending registration",
        "requestBody": {"required": True, "content": {"application/json": {"schema": {
            "type": "object", "required": ["email"],
            "properties": {"email": {"type": "string", "example": "person@example.com"}},
        }}}},
        "responses": {"200": {"description": "Approval email resent"}, "404": {"description": "Not found"}},
    }}

    paths["/auth/login"] = {"post": {
        "tags": ["Auth"], "summary": "Login with email and password",
        "requestBody": {"required": True, "content": {"application/json": {
            "schema": {"$ref": "#/components/schemas/AuthLoginRequest"}}}},
        "responses": {"200": {"description": "Login success"}, "401": {"description": "Invalid credentials"}},
    }}

    paths["/auth/forgot-password"] = {"post": {
        "tags": ["Auth"], "summary": "Reset password by email",
        "requestBody": {"required": True, "content": {"application/json": {
            "schema": {"$ref": "#/components/schemas/AuthForgotPasswordRequest"}}}},
        "responses": {"200": {"description": "Password updated"}, "404": {"description": "User not found"}},
    }}

    paths["/auth/me"] = {"get": {
        "tags": ["Auth"], "summary": "Get current authenticated user",
        "security": [{"BearerAuth": []}],
        "responses": {"200": {"description": "Current user"}, "401": {"description": "Unauthorized"}},
    }}

    paths["/auth/logout"] = {"post": {
        "tags": ["Auth"], "summary": "Logout (stateless)",
        "security": [{"BearerAuth": []}],
        "responses": {"200": {"description": "Logout acknowledged"}, "401": {"description": "Unauthorized"}},
    }}

    # Apply BearerAuth security to all protected routes
    for path_name, methods in paths.items():
        if not isinstance(methods, dict):
            continue
        is_protected = (
            path_name == "/tables"
            or path_name.startswith("/medications")
            or path_name == "/auth/me"
        )
        if not is_protected:
            continue
        for operation in methods.values():
            if isinstance(operation, dict):
                operation["security"] = [{"BearerAuth": []}]


# Module-level singleton — loaded once at import time
openapi_spec = load_openapi_spec()
