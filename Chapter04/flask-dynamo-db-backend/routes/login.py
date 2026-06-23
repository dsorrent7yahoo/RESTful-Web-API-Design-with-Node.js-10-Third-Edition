"""
routes/login.py
Blueprint for the login page, health check, and frontend launcher.
"""
import os

from flask import Blueprint, render_template

login_bp = Blueprint("login", __name__)


@login_bp.route("/", methods=["GET"])
def index():
    """Serve the login / register HTML page."""
    return render_template("index.html")


@login_bp.route("/health", methods=["GET"])
def health():
    """Basic health check."""
    from flask import jsonify
    return jsonify({"status": "ok"})


@login_bp.route("/launch/frontend", methods=["GET"])
def launch_frontend():
    """Return the React frontend URL so the caller can open it."""
    from flask import jsonify
    frontend_port = os.getenv("FRONTEND_PORT", "5174")
    frontend_host = os.getenv("FRONTEND_HOST", "localhost")
    scheme = os.getenv("FRONTEND_SCHEME", "http")
    url = f"{scheme}://{frontend_host}:{frontend_port}"
    return jsonify({"url": url, "message": f"Frontend available at {url}"})
