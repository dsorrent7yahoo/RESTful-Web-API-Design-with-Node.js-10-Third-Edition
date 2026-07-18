"""
routes/login.py
Blueprint for the React SPA entry point, static assets, health check, and frontend launcher.
"""
import os

from flask import Blueprint, jsonify, render_template, send_from_directory

login_bp = Blueprint("login", __name__)

# Populated by Dockerfile: COPY --from=frontend-builder /frontend/dist /app/static/react
REACT_DIST = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'static', 'react'))


@login_bp.route("/", methods=["GET"])
def index():
    """Serve the React SPA. Falls back to Flask login template if dist not built."""
    react_index = os.path.join(REACT_DIST, 'index.html')
    if os.path.isfile(react_index):
        return send_from_directory(REACT_DIST, 'index.html')
    return render_template("index.html")


@login_bp.route("/assets/<path:filename>", methods=["GET"])
def react_assets(filename):
    """Serve Vite-built JS/CSS bundles."""
    return send_from_directory(os.path.join(REACT_DIST, 'assets'), filename)


@login_bp.route("/health", methods=["GET"])
def health():
    """Basic health check."""
    return jsonify({"status": "ok"})


@login_bp.route("/launch/frontend", methods=["GET"])
def launch_frontend():
    """Return the React frontend URL so the caller can open it."""
    frontend_port = os.getenv("FRONTEND_PORT", "5174")
    frontend_host = os.getenv("FRONTEND_HOST", "localhost")
    scheme = os.getenv("FRONTEND_SCHEME", "http")
    url = f"{scheme}://{frontend_host}:{frontend_port}"
    return jsonify({"url": url, "message": f"Frontend available at {url}"})
