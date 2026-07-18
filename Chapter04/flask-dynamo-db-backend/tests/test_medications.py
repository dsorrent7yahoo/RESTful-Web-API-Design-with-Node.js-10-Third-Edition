"""Tests for /medications/* routes (all JWT-protected)."""


# -- Unauthenticated guards ---------------------------------------------------

def test_list_requires_auth(client):
    assert client.get("/medications").status_code == 401

def test_create_requires_auth(client):
    assert client.post("/medications", json={}).status_code == 401

def test_get_by_id_requires_auth(client):
    assert client.get("/medications/id/abc").status_code == 401

def test_update_requires_auth(client):
    assert client.put("/medications/abc", json={}).status_code == 401


# -- List / query ------------------------------------------------------------

def test_list_empty_table(client, auth_headers):
    resp = client.get("/medications", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.get_json()["items"] == []


def test_list_returns_created_items(client, auth_headers, make_medication):
    make_medication()
    make_medication({"code": "9999", "description": "Ibuprofen 200mg"})
    resp = client.get("/medications", headers=auth_headers)
    assert resp.status_code == 200
    assert len(resp.get_json()["items"]) == 2


def test_list_respects_limit(client, auth_headers, make_medication):
    for i in range(5):
        make_medication({"code": str(i), "patient": f"p{i}"})
    resp = client.get("/medications?limit=2", headers=auth_headers)
    assert resp.status_code == 200
    assert len(resp.get_json()["items"]) <= 2


# -- Create ------------------------------------------------------------------

def test_create_returns_201(client, auth_headers):
    resp = client.post(
        "/medications",
        json={"patient": "p1", "code": "12345", "description": "Metformin 500mg"},
        headers=auth_headers,
    )
    assert resp.status_code == 201


def test_create_persists_fields(client, auth_headers, make_medication):
    item = make_medication({"patient": "patient-check", "code": "55555"})
    assert item["patient"] == "patient-check"
    assert item["code"] == "55555"
    assert "id" in item


# -- Read by ID --------------------------------------------------------------

def test_get_by_id(client, auth_headers, make_medication):
    created = make_medication()
    resp = client.get(f"/medications/id/{created['id']}", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.get_json()["id"] == created["id"]


def test_get_by_id_not_found(client, auth_headers):
    assert client.get("/medications/id/does-not-exist", headers=auth_headers).status_code == 404


# -- Update ------------------------------------------------------------------

def test_update_medication(client, auth_headers, make_medication):
    created = make_medication({"description": "Old name"})
    resp = client.put(
        f"/medications/{created['id']}",
        json={"description": "Updated name"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.get_json()["description"] == "Updated name"


def test_update_nonexistent_returns_404(client, auth_headers):
    resp = client.put("/medications/does-not-exist", json={"description": "Ghost"}, headers=auth_headers)
    assert resp.status_code == 404


# -- Query by patient --------------------------------------------------------

def test_query_by_patient(client, auth_headers, make_medication):
    make_medication({"patient": "alice", "code": "111"})
    make_medication({"patient": "alice", "code": "222"})
    make_medication({"patient": "bob",   "code": "333"})
    resp = client.get("/medications/patient/alice", headers=auth_headers)
    assert resp.status_code == 200
    items = resp.get_json()
    assert len(items) == 2
    assert all(m["patient"] == "alice" for m in items)


def test_query_by_patient_empty(client, auth_headers):
    resp = client.get("/medications/patient/nobody", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.get_json() == []


# -- Query by code -----------------------------------------------------------

def test_query_by_code(client, auth_headers, make_medication):
    make_medication({"code": "ASPIRIN", "patient": "p1"})
    make_medication({"code": "ASPIRIN", "patient": "p2"})
    make_medication({"code": "OTHER",   "patient": "p3"})
    resp = client.get("/medications/code/ASPIRIN", headers=auth_headers)
    assert resp.status_code == 200
    items = resp.get_json()
    assert len(items) == 2
    assert all(m["code"] == "ASPIRIN" for m in items)
