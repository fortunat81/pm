"""AI chat router and service.

`POST /api/chat` takes a user message, builds a prompt from the user's current
board + prior history, calls the model with a structured-output schema, persists
the exchange, and applies any returned board update.
"""
import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, ValidationError

from app.auth import get_session_user
from app.db import Board, ChatMessage, User
from app.kanban import _get_user_or_404, _load_or_create_board, get_db
from app.openrouter import OpenRouterError, chat
from app.schema import BoardDataModel

router = APIRouter(prefix="/api/chat", tags=["chat"])

SYSTEM_PROMPT = """You manage the user's Kanban board.
You will be given the current board state as JSON, then the conversation history, then the user's latest request.

Rules:
- Return a short, friendly reply in plain conversational text only. Never include JSON or code in reply. Never use emojis.
- If the user asks you to change the board (add/edit/move/delete a card or rename a column), return the COMPLETE new board state in boardUpdate, with every card and column present. Put the JSON ONLY in boardUpdate, never in reply.
- If no board change is requested, return boardUpdate as null.
- Match the existing card and column id style (e.g. card-9, col-backlog). Preserve columns and cards you are not changing."""

MAX_HISTORY_MESSAGES = 20  # most recent user/assistant rows to include as context


class ChatBody(BaseModel):
    message: str


class AiReplyModel(BaseModel):
    """Parsed structured output from the model.

    `boardUpdate` is required but nullable: strict JSON schema requires every
    key to be present, and `null` means "no board change".
    """

    model_config = ConfigDict(extra="forbid")

    reply: str
    boardUpdate: BoardDataModel | None


def _structured_schema() -> dict:
    """Return the OpenAI-style json_schema for the model's structured output."""
    schema = AiReplyModel.model_json_schema()
    return {
        "type": "json_schema",
        "json_schema": {
            "name": "kanban_reply",
            "strict": True,
            "schema": schema,
        },
    }


def _build_messages(
    board_data: dict[str, Any], history: list[ChatMessage], message: str
) -> list[dict[str, Any]]:
    """Assemble the prompt: board context + history + the new user message."""
    segments = [f"Current board state (JSON):\n{json.dumps(board_data)}"]
    # History is already limited to the most recent MAX_HISTORY_MESSAGES rows.
    for row in history:
        segments.append(f"{row.role}: {row.content}")
    segments.append(f"user: {message}")

    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": "\n\n".join(segments)},
    ]


def _apply_board_update(session, board: Board, update: BoardDataModel | None) -> None:
    """Persist the model's board update to the DB if one was returned."""
    if update is None:
        return
    board.data = update.model_dump()
    board.version += 1
    session.commit()


def _load_history(session, user: User, board: Board) -> list[ChatMessage]:
    """Return the most recent chat rows for the user's board, oldest first.

    Ordered by primary key, not `created_at`: SQLite's `CURRENT_TIMESTAMP`
    only has second resolution, so timestamp order alone isn't deterministic
    for rows inserted within the same second (routine for a user/assistant
    pair saved together).
    """
    rows = (
        session.query(ChatMessage)
        .filter_by(user_id=user.id, board_id=board.id)
        .order_by(ChatMessage.id.desc())
        .limit(MAX_HISTORY_MESSAGES)
        .all()
    )
    return list(reversed(rows))


def _save_messages(
    session, user: User, board: Board, user_msg: str, assistant_reply: str
) -> None:
    """Persist the user message and assistant reply as chat history."""
    session.add(
        ChatMessage(user_id=user.id, board_id=board.id, role="user", content=user_msg)
    )
    session.add(
        ChatMessage(
            user_id=user.id, board_id=board.id, role="assistant", content=assistant_reply
        )
    )
    session.commit()


@router.get("/history")
def chat_history(
    username: str = Depends(get_session_user),
    session=Depends(get_db),
) -> dict[str, Any]:
    """Return the signed-in user's prior chat messages, oldest first."""
    user = _get_user_or_404(session, username)
    board = _load_or_create_board(session, user)
    rows = _load_history(session, user, board)
    return {
        "messages": [
            {"role": row.role, "content": row.content} for row in rows
        ]
    }


@router.delete("/history")
def clear_chat_history(
    username: str = Depends(get_session_user),
    session=Depends(get_db),
) -> dict[str, str]:
    """Clear the signed-in user's chat history for their board."""
    user = _get_user_or_404(session, username)
    board = _load_or_create_board(session, user)
    session.query(ChatMessage).filter_by(
        user_id=user.id, board_id=board.id
    ).delete()
    session.commit()
    return {"status": "ok"}


@router.post("")
def chat_endpoint(
    body: ChatBody,
    username: str = Depends(get_session_user),
    session=Depends(get_db),
) -> dict[str, Any]:
    """Send a message to the AI with board + history context; return reply + optional update."""
    user = _get_user_or_404(session, username)
    board = _load_or_create_board(session, user)

    history = _load_history(session, user, board)
    messages = _build_messages(board.data, history, body.message)

    try:
        raw = chat(messages, response_format=_structured_schema())
    except OpenRouterError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    try:
        payload = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        # Not JSON at all: treat the raw text as the reply, no board change.
        reply_text = raw if raw and raw.strip() else "I could not produce a response."
        parsed = AiReplyModel(reply=reply_text, boardUpdate=None)
    else:
        try:
            parsed = AiReplyModel.model_validate(payload)
        except ValidationError:
            # Valid JSON that fails our schema (e.g. a malformed boardUpdate):
            # never echo the raw JSON blob back as a chat reply.
            parsed = AiReplyModel(
                reply="I couldn't apply that change. Could you try rephrasing your request?",
                boardUpdate=None,
            )

    _apply_board_update(session, board, parsed.boardUpdate)
    _save_messages(session, user, board, body.message, parsed.reply)

    return {
        "reply": parsed.reply,
        "boardUpdate": (
            parsed.boardUpdate.model_dump() if parsed.boardUpdate is not None else None
        ),
        "version": board.version,
    }

