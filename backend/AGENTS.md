# Backend

FastAPI backend for the Project Management MVP. Serves static frontend at `/` and API routes under `/api`.

## Structure

- `app/main.py` - FastAPI app; `create_app()` factory; `/api/health`; adds `SessionMiddleware`; sets up the DB session factory + seeding; mounts the static frontend at `/`
- `app/auth.py` - auth router (`/api/auth/login`, `/api/auth/logout`, `/api/auth/me`) and `get_session_user(request)` dependency
- `app/db.py` - SQLAlchemy models (`User`, `Board`, `ChatMessage`), `make_session_factory()`, `seed_defaults()`, `DEFAULT_BOARD_DATA`
- `app/kanban.py` - kanban router (`GET/POST /api/kanban`) with Pydantic board validation, optimistic-concurrency version checks, and auth protection
- `app/openrouter.py` - OpenRouter client wrapper (`chat(messages, model, response_format)` returns assistant text; `OpenRouterError` on failure). Key from `OPENROUTER_API_KEY` env; model from `OPENROUTER_MODEL` (default `openai/gpt-oss-120b`)
- `app/chat.py` - chat router + service (`POST /api/chat`, `GET /api/chat/history`, auth-protected). Loads the user's board + prior `chat_messages` history, calls the model with a strict structured-output schema (`{reply: string, boardUpdate: BoardData | null}`), persists the exchange, and applies a returned board update. `POST /api/chat/test` (Part 8 debug) was replaced by this.
- `app/schema.py` - shared Pydantic models (`CardModel`, `ColumnModel`, `BoardDataModel`, `BoardUpdate`) mirroring the frontend `BoardData`; used by both kanban and chat
- `app/__init__.py` - package marker
- `tests/` - pytest suites for health, auth, kanban, chat
- `pyproject.toml` - project config and dependencies, managed with `uv`

## Auth

MVP uses a single hardcoded user (`user` / `password`). Login sets a signed `HttpOnly` session cookie (Starlette `SessionMiddleware`, `itsdangerous`); the session stores the username and is stateless. `get_session_user(request)` returns the current username or raises 401. `SESSION_SECRET` is configurable via env var (dev fallback in code).

## Database

SQLite via SQLAlchemy 2.x ORM. `DATABASE_PATH` env var sets the DB file (default `<repo root>/kanban.db` locally; Docker sets `/data/kanban.db` with a named volume). The file + tables are created automatically on startup. `seed_defaults()` runs once at startup and ensures the demo `user` and their default board (from `DEFAULT_BOARD_DATA`) exist. `create_app(static_dir=..., db_path=...)` lets tests use an isolated temp DB.

No migrations tooling (e.g. Alembic) is set up for this MVP — `Base.metadata.create_all()` only creates missing tables, not missing columns on an existing table. A model field change (like `Board.version`) requires deleting the local `kanban.db` and the Docker `kanban-data` volume so they recreate with the new schema; there is no production data to preserve.

`Board.version` is a monotonically increasing counter used for optimistic concurrency: `POST /api/kanban` requires the client's last-seen `version` and returns 409 if it doesn't match the current one (rejecting a stale write instead of silently overwriting a newer one), then increments it on success. `_apply_board_update` (in `app/chat.py`) also increments it when the AI changes the board, so a manual save that was in flight during a chat-driven update is detected as stale too.

## Static frontend

The app serves the statically exported Next.js frontend from `frontend/out`. Resolution order:
1. `FRONTEND_STATIC` env var if set (Docker sets it to `/app/frontend/out`).
2. Otherwise, `<repo root>/frontend/out`.

Backend unit tests pass a temp dir via `create_app(static_dir=...)` so they don't depend on a frontend build.

## Commands

- `uv sync` - install dependencies
- `uv run uvicorn app.main:app --reload` - run dev server locally
- `uv run pytest` - run tests

## Notes

- Port `8000`.
- Docker build/run is handled from the project root via `Dockerfile` and `compose.yaml`.