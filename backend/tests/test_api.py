from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_health_reports_local_runtime() -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["python"]


def test_upload_rejects_non_audio_extension_without_starting_model() -> None:
    response = client.post(
        "/api/transcriptions",
        files={"file": ("notes.txt", b"not audio", "text/plain")},
        data={"model_size": "small"},
    )
    assert response.status_code == 415


def test_local_library_rejects_requests_without_loopback_browser_origin() -> None:
    response = client.get("/api/local-library/packages")
    assert response.status_code == 403


def test_local_library_allows_loopback_browser() -> None:
    local_client = TestClient(
        app,
        base_url="http://127.0.0.1:8765",
        client=("127.0.0.1", 50000),
        headers={"Origin": "http://localhost:5173"},
    )
    response = local_client.get("/api/local-library/packages")
    assert response.status_code == 200
    assert isinstance(response.json(), list)


def test_local_library_rejects_non_loopback_origin() -> None:
    local_client = TestClient(
        app,
        base_url="http://127.0.0.1:8765",
        client=("127.0.0.1", 50000),
        headers={"Origin": "https://example.com"},
    )
    response = local_client.get("/api/local-library/packages")
    assert response.status_code == 403
