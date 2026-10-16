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
