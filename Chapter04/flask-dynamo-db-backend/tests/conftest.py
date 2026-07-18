"""
Pytest configuration and shared fixtures for flask-dynamo-db-backend tests.

Moto is started at module level BEFORE any app import so that the
module-level boto3 resource in model/medication.py is created inside
the mock context and never touches real AWS.
"""
import os
import pytest

# Must be set before any boto3/app import
os.environ.setdefault("AWS_DEFAULT_REGION", "us-east-1")
os.environ.setdefault("AWS_ACCESS_KEY_ID", "test")
os.environ.setdefault("AWS_SECRET_ACCESS_KEY", "test")
os.environ.setdefault("DYNAMODB_TABLE", "medications-test")
os.environ.setdefault("JWT_SECRET", "test-secret-for-ci")
os.environ.setdefault("AUTO_CREATE_CSV_TABLES", "false")
os.environ.setdefault("PORT", "4001")

from moto import mock_aws  # noqa: E402

_aws_mock = mock_aws()
_aws_mock.start()

from app import app as _flask_app  # noqa: E402

_flask_app.config["TESTING"] = True


@pytest.fixture(scope="session")
def app():
    return _flask_app


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture(autouse=True)
def reset_tables():
    import boto3
    ddb = boto3.client("dynamodb", region_name="us-east-1")
    for name in ddb.list_tables().get("TableNames", []):
        ddb.delete_table(TableName=name)
        ddb.get_waiter("table_not_exists").wait(TableName=name)

    from model import medication as model
    from modules.auth import (
        ensure_default_user_exists,
        ensure_pending_users_table_exists,
        ensure_users_table_exists,
    )
    model.ensure_table_exists()
    ensure_users_table_exists()
    ensure_pending_users_table_exists()
    ensure_default_user_exists()
    yield


@pytest.fixture
def auth_headers(client):
    resp = client.post(
        "/auth/login",
        json={"email": "react-dgs@yahoo.com", "password": "python"},
    )
    token = resp.get_json()["accessToken"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def make_medication(client, auth_headers):
    def _create(overrides=None):
        payload = {
            "patient": "test-patient-001",
            "code": "1049502",
            "description": "Aspirin 81 MG Oral Tablet",
            **(overrides or {}),
        }
        resp = client.post("/medications", json=payload, headers=auth_headers)
        assert resp.status_code == 201, resp.get_json()
        return resp.get_json()
    return _create
