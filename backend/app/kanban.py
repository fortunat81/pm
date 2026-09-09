from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request

from app.auth import get_session_user
from app.db import DEFAULT_BOARD_DATA, DEFAULT_BOARD_TITLE, Board, User
from app.schema import BoardDataModel, BoardUpdate

router = APIRouter(prefix="/api", tags=["kanban"])


def get_db(request: Request):
    """Yield a request-scoped DB session from the app's session factory."""
    SessionLocal = request.app.state.SessionLocal
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def _get_user_or_404(session, username: str) -> User:
    """Return the signed-in user's row. The demo user is seeded once at startup."""
    user = session.query(User).filter_by(username=username).first()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return user


def _load_or_create_board(session, user: User) -> Board:
    """Return the user's board, creating a default one on first access."""
    board = session.query(Board).filter_by(user_id=user.id).first()
    if board is None:
        board = Board(
            user_id=user.id, title=DEFAULT_BOARD_TITLE, data=DEFAULT_BOARD_DATA
        )
        session.add(board)
        session.commit()
    return board


@router.get("/kanban")
def get_kanban(
    username: str = Depends(get_session_user),
    session=Depends(get_db),
) -> dict[str, Any]:
    user = _get_user_or_404(session, username)
    board = _load_or_create_board(session, user)
    return {"title": board.title, "data": board.data, "version": board.version}


@router.post("/kanban")
def update_kanban(
    payload: BoardUpdate,
    username: str = Depends(get_session_user),
    session=Depends(get_db),
) -> dict[str, Any]:
    user = _get_user_or_404(session, username)
    board = _load_or_create_board(session, user)
    if payload.version != board.version:
        raise HTTPException(
            status_code=409,
            detail="Board was updated elsewhere. Reload to see the latest version.",
        )
    board.data = payload.data.model_dump()
    board.version += 1
    session.commit()
    return {"title": board.title, "data": board.data, "version": board.version}
