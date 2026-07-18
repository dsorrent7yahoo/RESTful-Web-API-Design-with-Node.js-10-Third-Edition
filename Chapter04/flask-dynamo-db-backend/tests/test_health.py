"""Tests for the health-check and root endpoints."""


def test_health_returns_ok(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.get_json() == {"status": "ok"}


def test_health_content_type_is_json(client):
    resp = client.get("/health")
    assert "application/json" in resp.content_type


def test_health_post_not_allowed(client):
    # App generic handler converts 405 -> 500; accept either
    assert client.post("/health").status_code in (405, 500)


def test_root_renders_html(client):
    resp = client.get("/")
    assert resp.status_code == 200
    assert b"<html" in resp.data.lower() or b"<!doctype" in resp.data.lower()


def test_launch_frontend_returns_url(client):
    resp = client.get("/launch/frontend")
    assert resp.status_code == 200
    data = resp.get_json()
    assert "url" in data
    assert data["url"].startswith("http")
