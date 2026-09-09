import os
from pathlib import Path
from typing import Any

from sqlalchemy import JSON, Column, DateTime, ForeignKey, Integer, String, create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.sql import func

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DB_PATH = REPO_ROOT / "kanban.db"

# Demo board seeded for a new user. Mirrors the frontend initialData shape.
DEFAULT_BOARD_TITLE = "My Board"
DEFAULT_BOARD_DATA: dict[str, Any] = {
    "columns": [
        {"id": "col-backlog", "title": "Backlog", "cardIds": ["card-1", "card-2"]},
        {"id": "col-discovery", "title": "Discovery", "cardIds": ["card-3"]},
        {
            "id": "col-progress",
            "title": "In Progress",
            "cardIds": ["card-4", "card-5"],
        },
        {"id": "col-review", "title": "Review", "cardIds": ["card-6"]},
        {"id": "col-done", "title": "Done", "cardIds": ["card-7", "card-8"]},
    ],
    "cards": {
        "card-1": {
            "id": "card-1",
            "title": "Align roadmap themes",
            "details": "Draft quarterly themes with impact statements and metrics.",
        },
        "card-2": {
            "id": "card-2",
            "title": "Gather customer signals",
            "details": "Review support tags, sales notes, and churn feedback.",
        },
        "card-3": {
            "id": "card-3",
            "title": "Prototype analytics view",
            "details": "Sketch initial dashboard layout and key drill-downs.",
        },
        "card-4": {
            "id": "card-4",
            "title": "Refine status language",
            "details": "Standardize column labels and tone across the board.",
        },
        "card-5": {
            "id": "card-5",
            "title": "Design card layout",
            "details": "Add hierarchy and spacing for scanning dense lists.",
        },
        "card-6": {
            "id": "card-6",
            "title": "QA micro-interactions",
            "details": "Verify hover, focus, and loading states.",
        },
        "card-7": {
            "id": "card-7",
            "title": "Ship marketing page",
            "details": "Final copy approved and asset pack delivered.",
        },
        "card-8": {
            "id": "card-8",
            "title": "Close onboarding sprint",
            "details": "Document release notes and share internally.",
        },
    },
}


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: int = Column(Integer, primary_key=True)
    username: str = Column(String, unique=True, nullable=False)
    password_hash: str | None = Column(String, nullable=True)
    created_at = Column(DateTime, server_default=func.now())


class Board(Base):
    __tablename__ = "boards"

    id: int = Column(Integer, primary_key=True)
    user_id: int = Column(
        Integer, ForeignKey("users.id"), unique=True, nullable=False
    )
    title: str = Column(String, nullable=False, default="My Board")
    data: dict[str, Any] = Column(JSON, nullable=False)
    version: int = Column(Integer, nullable=False, default=1)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: int = Column(Integer, primary_key=True)
    user_id: int = Column(Integer, ForeignKey("users.id"), nullable=False)
    board_id: int | None = Column(Integer, ForeignKey("boards.id"), nullable=True)
    role: str = Column(String, nullable=False)
    content: str = Column(String, nullable=False)
    created_at = Column(DateTime, server_default=func.now())


def make_session_factory(db_path: Path | None = None) -> sessionmaker[Session]:
    """Create the SQLite file (if missing) and tables; return a session factory."""
    if db_path is None:
        db_path = Path(os.environ.get("DATABASE_PATH", str(DEFAULT_DB_PATH)))
    db_path.parent.mkdir(parents=True, exist_ok=True)
    engine = create_engine(
        f"sqlite:///{db_path}", connect_args={"check_same_thread": False}
    )
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, expire_on_commit=False)


def seed_defaults(session: Session) -> None:
    """Ensure the demo user and their default board exist."""
    user = session.query(User).filter_by(username="user").first()
    if user is None:
        user = User(username="user")
        session.add(user)
        session.flush()
    board = session.query(Board).filter_by(user_id=user.id).first()
    if board is None:
        session.add(
            Board(user_id=user.id, title=DEFAULT_BOARD_TITLE, data=DEFAULT_BOARD_DATA)
        )
    session.commit()
