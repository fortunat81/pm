from fastapi.testclient import TestClient

from app.main import create_app


def make_client(tmp_path) -> TestClient:
    (tmp_path / "index.html").write_text("<h1>Hello, world</h1>")
    return TestClient(
        create_app(static_dir=tmp_path, db_path=tmp_path / "test.db")
    )


def test_login_success_sets_cookie(tmp_path) -> None:
    client = make_client(tmp_path)
    response = client.post(
        "/api/auth/login", json={"username": "user", "password": "password"}
    )
    assert response.status_code == 200
    assert response.json() == {"username": "user"}
    assert "session" in response.cookies


def test_login_wrong_password_returns_401(tmp_path) -> None:
    client = make_client(tmp_path)
    response = client.post(
        "/api/auth/login", json={"username": "user", "password": "wrong"}
    )
    assert response.status_code == 401


def test_me_unauthenticated_returns_401(tmp_path) -> None:
    client = make_client(tmp_path)
    response = client.get("/api/auth/me")
    assert response.status_code == 401


def test_me_after_login_returns_user(tmp_path) -> None:
    client = make_client(tmp_path)
    client.post(
        "/api/auth/login", json={"username": "user", "password": "password"}
    )
    response = client.get("/api/auth/me")
    assert response.status_code == 200
    assert response.json() == {"username": "user"}


def test_logout_clears_session(tmp_path) -> None:
    client = make_client(tmp_path)
    client.post(
        "/api/auth/login", json={"username": "user", "password": "password"}
    )
    logout = client.post("/api/auth/logout")
    assert logout.status_code == 200
    me = client.get("/api/auth/me")
    assert me.status_code == 401
