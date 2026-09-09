import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

from app.auth import router as auth_router
from app.chat import router as chat_router
from app.db import make_session_factory, seed_defaults
from app.kanban import router as kanban_router

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_STATIC = REPO_ROOT / "frontend" / "out"
SESSION_SECRET = os.environ.get(
    "SESSION_SECRET", "dev-secret-change-me-in-production"
)


def create_app(
    static_dir: Path | None = None, db_path: Path | None = None
) -> FastAPI:
    app = FastAPI(title="Project Management MVP")
    app.add_middleware(SessionMiddleware, secret_key=SESSION_SECRET)

    if static_dir is None:
        static_dir = Path(os.environ.get("FRONTEND_STATIC", str(DEFAULT_STATIC)))

    SessionLocal = make_session_factory(db_path)
    app.state.SessionLocal = SessionLocal
    seed_defaults(SessionLocal())

    app.include_router(auth_router)
    app.include_router(kanban_router)
    app.include_router(chat_router)

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")
    return app


app = create_app()
