import json

from fastapi.testclient import TestClient

from app.chat import SYSTEM_PROMPT
from app.main import create_app

CREDENTIALS = {"username": "user", "password": "password"}

# The default board has a Backlog column (col-backlog) with card-1, card-2.


def make_client(tmp_path) -> TestClient:
    (tmp_path / "index.html").write_text("<h1>Hello, world</h1>")
    return TestClient(
        create_app(static_dir=tmp_path, db_path=tmp_path / "test.db")
    )


def login(client: TestClient) -> None:
    response = client.post("/api/auth/login", json=CREDENTIALS)
    assert response.status_code == 200


def _structured_reply(reply: str, board_update) -> str:
    return json.dumps({"reply": reply, "boardUpdate": board_update})


def test_chat_requires_auth(tmp_path) -> None:
    client = make_client(tmp_path)
    response = client.post("/api/chat", json={"message": "hello"})
    assert response.status_code == 401


def test_chat_valid_update_applies_board_change(tmp_path, monkeypatch) -> None:
    client = make_client(tmp_path)
    login(client)

    # Full board JSON with a new card added to the Backlog column.
    new_card = {"id": "card-9", "title": "Test AI card", "details": "Created by AI"}
    board = client.get("/api/kanban").json()["data"]
    board["cards"]["card-9"] = new_card
    board["columns"][0]["cardIds"].append("card-9")

    monkeypatch.setattr(
        "app.chat.chat",
        lambda messages, response_format=None: _structured_reply(
            "Added card-9 to Backlog.", board
        ),
    )
    response = client.post("/api/chat", json={"message": "Add a Test AI card"})
    assert response.status_code == 200
    body = response.json()
    assert body["reply"] == "Added card-9 to Backlog."
    assert body["boardUpdate"]["cards"]["card-9"]["title"] == "Test AI card"

    # Change is persisted and visible via GET /api/kanban.
    fetched = client.get("/api/kanban").json()["data"]
    assert "card-9" in fetched["cards"]
    assert "card-9" in fetched["columns"][0]["cardIds"]


def test_chat_null_update_leaves_board_unchanged(tmp_path, monkeypatch) -> None:
    client = make_client(tmp_path)
    login(client)

    before = client.get("/api/kanban").json()["data"]
    monkeypatch.setattr(
        "app.chat.chat",
        lambda messages, response_format=None: _structured_reply(
            "No change made.", None
        ),
    )
    response = client.post("/api/chat", json={"message": "What is on my board?"})
    assert response.status_code == 200
    assert response.json()["reply"] == "No change made."
    assert response.json()["boardUpdate"] is None

    after = client.get("/api/kanban").json()["data"]
    assert after == before


def test_chat_malformed_content_falls_back_gracefully(tmp_path, monkeypatch) -> None:
    client = make_client(tmp_path)
    login(client)

    before = client.get("/api/kanban").json()["data"]
    monkeypatch.setattr(
        "app.chat.chat",
        lambda messages, response_format=None: "this is not valid JSON",
    )
    response = client.post("/api/chat", json={"message": "do something weird"})
    assert response.status_code == 200
    assert response.json()["reply"] == "this is not valid JSON"
    assert response.json()["boardUpdate"] is None

    after = client.get("/api/kanban").json()["data"]
    assert after == before


def test_chat_null_content_returns_safe_reply(tmp_path, monkeypatch) -> None:
    client = make_client(tmp_path)
    login(client)

    before = client.get("/api/kanban").json()["data"]
    # Models can return null/empty content; the API must not 500.
    monkeypatch.setattr(
        "app.chat.chat",
        lambda messages, response_format=None: "",
    )
    response = client.post("/api/chat", json={"message": "hello?"})
    assert response.status_code == 200
    assert response.json()["boardUpdate"] is None

    after = client.get("/api/kanban").json()["data"]
    assert after == before


def test_chat_persists_history(tmp_path, monkeypatch) -> None:
    client = make_client(tmp_path)
    login(client)

    monkeypatch.setattr(
        "app.chat.chat",
        lambda messages, response_format=None: _structured_reply("Hello back.", None),
    )
    client.post("/api/chat", json={"message": "Hi there"})
    client.post("/api/chat", json={"message": "Again"})

    # Two turns -> 4 chat_messages rows (user/assistant x2).
    from app.db import ChatMessage, make_session_factory

    SessionLocal = make_session_factory(tmp_path / "test.db")
    session = SessionLocal()
    try:
        rows = session.query(ChatMessage).all()
        assert len(rows) == 4
        assert [r.role for r in rows] == ["user", "assistant", "user", "assistant"]
        assert rows[0].content == "Hi there"
        assert rows[2].content == "Again"
    finally:
        session.close()


def test_chat_history_is_sent_to_model(tmp_path, monkeypatch) -> None:
    client = make_client(tmp_path)
    login(client)

    captured: dict = {}

    def fake_chat(messages, response_format=None):
        captured["messages"] = messages
        return _structured_reply("ok", None)

    monkeypatch.setattr("app.chat.chat", fake_chat)
    client.post("/api/chat", json={"message": "First message"})
    client.post("/api/chat", json={"message": "Second message"})

    messages = captured["messages"]
    # System prompt present, board JSON present, both user turns present.
    assert messages[0]["role"] == "system"
    assert SYSTEM_PROMPT in messages[0]["content"]
    combined = "\n".join(m["content"] for m in messages)
    assert "Current board state (JSON):" in combined
    assert "First message" in combined
    assert "Second message" in combined


def test_chat_history_returns_most_recent_messages_when_truncated(
    tmp_path, monkeypatch
) -> None:
    client = make_client(tmp_path)
    login(client)

    monkeypatch.setattr(
        "app.chat.chat",
        lambda messages, response_format=None: _structured_reply("ok", None),
    )
    # 15 turns = 30 chat_messages rows; MAX_HISTORY_MESSAGES (20) keeps the
    # most recent 20 rows, i.e. turns 5-14 (messages 0-4 must be dropped).
    for i in range(15):
        client.post("/api/chat", json={"message": f"message {i}"})

    response = client.get("/api/chat/history")
    assert response.status_code == 200
    messages = response.json()["messages"]
    assert len(messages) == 20

    user_contents = [m["content"] for m in messages if m["role"] == "user"]
    assert "message 0" not in user_contents
    assert "message 4" not in user_contents
    assert "message 5" in user_contents
    assert "message 14" in user_contents
    # Oldest-first order is preserved for the kept window.
    assert user_contents == sorted(
        user_contents, key=lambda c: int(c.split()[-1])
    )


def test_chat_dangling_card_reference_falls_back_safely(tmp_path, monkeypatch) -> None:
    client = make_client(tmp_path)
    login(client)

    before = client.get("/api/kanban").json()["data"]
    broken_board = json.loads(json.dumps(before))
    broken_board["columns"][0]["cardIds"].append("card-does-not-exist")

    monkeypatch.setattr(
        "app.chat.chat",
        lambda messages, response_format=None: _structured_reply(
            "Added it.", broken_board
        ),
    )
    response = client.post("/api/chat", json={"message": "add a bogus card"})
    assert response.status_code == 200
    body = response.json()
    assert body["boardUpdate"] is None
    assert "couldn't apply" in body["reply"].lower()
    # The malformed board JSON must never be echoed back as the reply.
    assert "cardIds" not in body["reply"]

    after = client.get("/api/kanban").json()["data"]
    assert after == before


def test_chat_test_endpoint_removed(tmp_path) -> None:
    """Part 8's /api/chat/test debug route was replaced by POST /api/chat."""
    client = make_client(tmp_path)
    login(client)
    response = client.post("/api/chat/test", json={"message": "What is 2+2?"})
    # 404 (no such route) or 405 (path exists with other methods) both prove
    # the old /test debug endpoint no longer accepts POST.
    assert response.status_code in (404, 405)


def test_chat_history_requires_auth(tmp_path) -> None:
    client = make_client(tmp_path)
    response = client.get("/api/chat/history")
    assert response.status_code == 401


def test_chat_history_empty_for_new_user(tmp_path) -> None:
    client = make_client(tmp_path)
    login(client)
    response = client.get("/api/chat/history")
    assert response.status_code == 200
    assert response.json() == {"messages": []}


def test_chat_history_returns_persisted_messages(tmp_path, monkeypatch) -> None:
    client = make_client(tmp_path)
    login(client)
    monkeypatch.setattr(
        "app.chat.chat",
        lambda messages, response_format=None: _structured_reply("Hi back", None),
    )
    client.post("/api/chat", json={"message": "Hello"})
    client.post("/api/chat", json={"message": "Again"})

    response = client.get("/api/chat/history")
    assert response.status_code == 200
    messages = response.json()["messages"]
    assert len(messages) == 4
    assert [m["role"] for m in messages] == [
        "user", "assistant", "user", "assistant",
    ]
    assert messages[0]["content"] == "Hello"
    assert messages[2]["content"] == "Again"


def test_clear_chat_history_requires_auth(tmp_path) -> None:
    client = make_client(tmp_path)
    response = client.delete("/api/chat/history")
    assert response.status_code == 401


def test_clear_chat_history_empties_messages(tmp_path, monkeypatch) -> None:
    client = make_client(tmp_path)
    login(client)
    monkeypatch.setattr(
        "app.chat.chat",
        lambda messages, response_format=None: _structured_reply("Hi back", None),
    )
    client.post("/api/chat", json={"message": "Hello"})

    response = client.delete("/api/chat/history")
    assert response.status_code == 200

    history = client.get("/api/chat/history").json()["messages"]
    assert history == []

