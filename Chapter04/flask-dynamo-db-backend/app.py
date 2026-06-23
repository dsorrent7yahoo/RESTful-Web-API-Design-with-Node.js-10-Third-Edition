import os

from dotenv import load_dotenv

load_dotenv(
    dotenv_path=os.path.join(os.path.dirname(__file__), ".env"),
    override=False,
)

from flask import Flask, jsonify
from model import medication as medication_model
from modules import auth, medications
from routes.login import login_bp
from routes.dynamodb import dynamodb_bp
from routes.medications import medications_bp
from routes.auth import auth_bp
from routes.upload import upload_bp
from routes.export import export_bp
from routes.source import source_bp
from utils.startup import apply_startup_overrides_from_args, ensure_default_csv_tables_exist


app = Flask(__name__)
app.url_map.strict_slashes = False


@app.before_request
def handle_preflight():
    from flask import request
    if request.method == "OPTIONS":
        response = app.make_default_options_response()
        return _add_cors_headers(response)
    return None


@app.after_request
def add_cors_headers(response):
    return _add_cors_headers(response)


def _add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET,POST,PUT,DELETE,OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    return response


app.register_blueprint(login_bp)
app.register_blueprint(dynamodb_bp)
app.register_blueprint(medications_bp)
app.register_blueprint(auth_bp)
app.register_blueprint(upload_bp)
app.register_blueprint(export_bp)
app.register_blueprint(source_bp)



@app.errorhandler(medications.ApiError)
def handle_api_error(error):
    return jsonify(error.payload), error.status_code


@app.errorhandler(auth.ApiError)
def handle_auth_api_error(error):
    return jsonify(error.payload), error.status_code


@app.errorhandler(404)
def handle_404(error):
    return jsonify({"message": "Not Found", "error": {}}), 404


@app.errorhandler(Exception)
def handle_exception(error):
    return jsonify({"message": str(error), "error": {}}), 500


if __name__ == "__main__":
    apply_startup_overrides_from_args()
    ensure_default_csv_tables_exist()
    medication_model.ensure_table_exists()
    auth.ensure_users_table_exists()
    auth.ensure_pending_users_table_exists()
    auth.ensure_default_user_exists()
    port = int(os.getenv("PORT", "4001"))
    app.run(host="0.0.0.0", port=port)
