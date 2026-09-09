from fastapi.testclient import TestClient

from app.db import DEFAULT_BOARD_DATA, DEFAULT_BOARD_TITLE
from app.main import create_app

CREDENTIALS = {"username": "user", "password": "password"}


def make_client(tmp_path) -> TestClient:
    (tmp_path / "index.html").write_text("<h1>Hello, world</h1>")
    return TestClient(
        create_app(static_dir=tmp_path, db_path=tmp_path / "test.db")
    )


def login(client: TestClient) -> None:
    response = client.post("/api/auth/login", json=CREDENTIALS)
    assert response.status_code == 200


def test_get_kanban_requires_auth(tmp_path) -> None:
    client = make_client(tmp_path)
    response = client.get("/api/kanban")
    assert response.status_code == 401


def test_get_kanban_returns_default_board(tmp_path) -> None:
    client = make_client(tmp_path)
    login(client)
    response = client.get("/api/kanban")
    assert response.status_code == 200
    body = response.json()
    assert body["title"] == DEFAULT_BOARD_TITLE
    assert body["data"] == DEFAULT_BOARD_DATA
    assert len(body["data"]["columns"]) == 5


def test_update_kanban_persists(tmp_path) -> None:
    client = make_client(tmp_path)
    login(client)

    current = client.get("/api/kanban").json()
    new_board = {
        "columns": [
            {"id": "col-a", "title": "Todo", "cardIds": ["card-x"]}
        ],
        "cards": {
            "card-x": {"id": "card-x", "title": "New task", "details": "Do it"}
        },
    }
    response = client.post(
        "/api/kanban", json={"data": new_board, "version": current["version"]}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["data"] == new_board
    assert body["version"] == current["version"] + 1

    # A fresh client (new session but same DB) still sees the persisted board.
    client2 = make_client(tmp_path)
    login(client2)
    get_response = client2.get("/api/kanban")
    assert get_response.status_code == 200
    assert get_response.json()["data"] == new_board


def test_update_kanban_rejects_invalid_board(tmp_path) -> None:
    client = make_client(tmp_path)
    login(client)

    current = client.get("/api/kanban").json()
    invalid = {"columns": [{"id": "col-a", "cardIds": []}], "cards": {}}
    response = client.post(
        "/api/kanban", json={"data": invalid, "version": current["version"]}
    )
    assert response.status_code == 422


def test_update_kanban_rejects_dangling_card_reference(tmp_path) -> None:
    client = make_client(tmp_path)
    login(client)

    current = client.get("/api/kanban").json()
    dangling = {
        "columns": [
            {"id": "col-a", "title": "Todo", "cardIds": ["card-missing"]}
        ],
        "cards": {},
    }
    response = client.post(
        "/api/kanban", json={"data": dangling, "version": current["version"]}
    )
    assert response.status_code == 422


def test_update_kanban_requires_auth(tmp_path) -> None:
    client = make_client(tmp_path)
    response = client.post(
        "/api/kanban",
        json={
            "data": {
                "columns": [{"id": "col-a", "title": "A", "cardIds": []}],
                "cards": {},
            },
            "version": 1,
        },
    )
    assert response.status_code == 401


def test_update_kanban_rejects_stale_version(tmp_path) -> None:
    client = make_client(tmp_path)
    login(client)

    current = client.get("/api/kanban").json()
    board = {
        "columns": [{"id": "col-a", "title": "Todo", "cardIds": []}],
        "cards": {},
    }
    first = client.post(
        "/api/kanban", json={"data": board, "version": current["version"]}
    )
    assert first.status_code == 200

    # Reusing the now-stale version is rejected instead of silently overwriting.
    stale = client.post(
        "/api/kanban", json={"data": board, "version": current["version"]}
    )
    assert stale.status_code == 409

    # The first write's data is unaffected by the rejected stale write.
    assert client.get("/api/kanban").json()["data"] == board
