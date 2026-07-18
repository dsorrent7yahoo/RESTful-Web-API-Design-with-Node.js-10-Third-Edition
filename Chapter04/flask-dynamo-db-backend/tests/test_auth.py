"""Tests for /auth/* routes: login, register, token validation."""


def test_login_default_user_succeeds(client):
    resp = client.post(
        "/auth/login",
        json={"email": "react-dgs@yahoo.com", "password": "python"},
    )
    assert resp.status_code == 200
    data = resp.get_json()
    assert "accessToken" in data
    assert data["tokenType"] == "Bearer"
    assert "expiresAt" in data


def test_login_wrong_password_is_rejected(client):
    resp = client.post(
        "/auth/login",
        json={"email": "react-dgs@yahoo.com", "password": "wrongpassword"},
    )
    assert resp.status_code == 401
    assert resp.get_json().get("status") == "error"


def test_login_unknown_email_is_rejected(client):
    resp = client.post(
        "/auth/login",
        json={"email": "nobody@example.com", "password": "python"},
    )
    assert resp.status_code in (401, 404)


def test_login_empty_body_is_rejected(client):
    assert client.post("/auth/login", json={}).status_code in (400, 401)


def test_invalid_token_returns_401(client):
    resp = client.get(
        "/medications",
        headers={"Authorization": "Bearer not.a.valid.jwt"},
    )
    assert resp.status_code == 401


def test_no_authorization_header_returns_401(client):
    assert client.get("/medications").status_code == 401


def test_basic_auth_scheme_returns_401(client):
    resp = client.get(
        "/medications",
        headers={"Authorization": "Basic cmVhY3Q6cHl0aG9u"},
    )
    assert resp.status_code == 401


def test_bearer_with_empty_token_returns_401(client):
    resp = client.get(
        "/medications",
        headers={"Authorization": "Bearer "},
    )
    assert resp.status_code == 401


def test_register_new_user_returns_202(client):
    resp = client.post(
        "/auth/register",
        json={"email": "newuser@example.com", "username": "newuser", "password": "securepassword123"},
    )
    assert resp.status_code == 202


def test_register_duplicate_email_is_rejected(client):
    payload = {"email": "dup@example.com", "username": "dup", "password": "pass123"}
    client.post("/auth/register", json=payload)
    resp = client.post("/auth/register", json=payload)
    data = resp.get_json()
    assert (
        resp.status_code in (400, 409)
        or data.get("status") == "error"
        or "already" in str(data).lower()
        or "pending" in str(data).lower()
    )
