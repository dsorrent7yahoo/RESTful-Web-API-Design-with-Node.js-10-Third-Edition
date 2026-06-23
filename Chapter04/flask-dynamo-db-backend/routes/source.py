import os
from flask import Blueprint, jsonify, request, abort

source_bp = Blueprint("source", __name__)

SOURCE_ROOT = os.environ.get("SOURCE_ROOT", "/source")

ALLOWED_EXTENSIONS = {
    ".py", ".js", ".jsx", ".ts", ".tsx", ".json", ".yaml", ".yml",
    ".tf", ".tfvars", ".md", ".txt", ".sh", ".ipynb",
    ".html", ".css", ".toml", ".cfg", ".ini", ".sql",
    ".csv",
}

SKIP_DIRS = {
    "__pycache__", "node_modules", ".terraform", ".git",
    ".venv", "venv", "dist", ".vite", ".pytest_cache",
}

ALLOWED_BASENAMES = {"Dockerfile", ".dockerignore", "Makefile", "Procfile", "requirements.txt"}


def _safe_path(rel_path):
    """Resolve rel_path under SOURCE_ROOT; abort 403 if it escapes."""
    safe = os.path.realpath(os.path.join(SOURCE_ROOT, rel_path.lstrip("/")))
    root = os.path.realpath(SOURCE_ROOT)
    if safe != root and not safe.startswith(root + os.sep):
        abort(403)
    return safe


def _build_tree(base_path, rel=""):
    children = []
    try:
        entries = sorted(
            os.scandir(base_path),
            key=lambda e: (e.is_file(), e.name.lower()),
        )
    except PermissionError:
        return children

    for entry in entries:
        if entry.name in SKIP_DIRS or entry.name.startswith(".terraform"):
            continue
        node_rel = (rel + "/" + entry.name).lstrip("/")
        if entry.is_dir(follow_symlinks=False):
            children.append({
                "name": entry.name,
                "path": node_rel,
                "type": "dir",
                "children": _build_tree(entry.path, node_rel),
            })
        else:
            ext = os.path.splitext(entry.name)[1].lower()
            if ext in ALLOWED_EXTENSIONS or entry.name in ALLOWED_BASENAMES:
                children.append({
                    "name": entry.name,
                    "path": node_rel,
                    "type": "file",
                })
    return children


@source_bp.route("/source/tree", methods=["GET"])
def get_tree():
    if not os.path.isdir(SOURCE_ROOT):
        return jsonify({"error": f"Source root not found: {SOURCE_ROOT}"}), 404
    tree = _build_tree(SOURCE_ROOT)
    return jsonify({"root": SOURCE_ROOT, "tree": tree})


@source_bp.route("/source/file", methods=["GET"])
def get_file():
    rel_path = request.args.get("path", "")
    if not rel_path:
        abort(400)
    full_path = _safe_path(rel_path)
    if not os.path.isfile(full_path):
        abort(404)
    ext = os.path.splitext(full_path)[1].lower()
    basename = os.path.basename(full_path)
    if ext not in ALLOWED_EXTENSIONS and basename not in ALLOWED_BASENAMES:
        abort(403)
    try:
        with open(full_path, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
    except OSError:
        abort(500)
    return jsonify({"path": rel_path, "content": content})
