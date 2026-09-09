from fastapi.testclient import TestClient

from app.main import create_app


def make_client(tmp_path) -> TestClient:
    (tmp_path / "index.html").write_text("<h1>Hello, world</h1>")
    return TestClient(
        create_app(static_dir=tmp_path, db_path=tmp_path / "test.db")
    )


def test_health(tmp_path) -> None:
    client = make_client(tmp_path)
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_index_served(tmp_path) -> None:
    client = make_client(tmp_path)
    response = client.get("/")
    assert response.status_code == 200
    assert "Hello, world" in response.text
