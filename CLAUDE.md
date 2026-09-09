# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A Project Management MVP: single-user Kanban board with an AI chat sidebar that can create/edit/move cards. NextJS static frontend served by a Python FastAPI backend, packaged as one Docker container. See `AGENTS.md` (root) for business requirements, tech decisions, and the color scheme, and `docs/PLAN.md` for the part-by-part build log and design rationale (schema, structured-output decisions, etc).

There are also `backend/AGENTS.md`, `frontend/AGENTS.md`, and `scripts/AGENTS.md` with directory-specific details — read the relevant one before working in that directory.

## Commands

### Backend (`backend/`, uses `uv`)
- `uv sync` — install dependencies
- `uv run uvicorn app.main:app --reload` — run dev server locally (port 8000)
- `uv run pytest` — run all tests
- `uv run pytest tests/test_chat.py::test_name` — run a single test

### Frontend (`frontend/`)
- `npm run dev` — dev server
- `npm run build` — production build (static export to `frontend/out/`)
- `npm run lint` — ESLint
- `npm run test` / `npm run test:unit` — Vitest unit tests
- `npm run test:e2e` — Playwright e2e (requires the full stack running in Docker on port 8000 — no embedded dev server)
- `npm run test:all` — unit + e2e

### Docker (project root)
- `docker compose up --build` (or `scripts/start.ps1` / `scripts/start.sh`) — build and run the full stack on port 8000
- `scripts/stop.ps1` / `scripts/stop.sh` — tear down

## Architecture

**Single source of truth is the server.** The frontend never keeps board or chat state that didn't come from an API response — every mutation POSTs immediately and the UI re-renders from what the backend returns (including AI-driven board updates).

**Build/serve model**: Next.js is built with `output: "export"` into `frontend/out/`, which FastAPI serves via `StaticFiles` at `/`. All API routes live under `/api`. Never run `next start` in production — the backend serves the static files. This means Playwright e2e must run against the Docker-served app, not a Next dev server.

**Auth**: MVP hardcodes one user (`user`/`password`). `/api/auth/login` sets a signed `HttpOnly` session cookie (Starlette `SessionMiddleware`); the cookie is stateless (carries the username). `get_session_user(request)` protects all `/api/kanban/*` and `/api/chat/*` routes.

**Database**: SQLite via SQLAlchemy 2.x, one JSON document per board (`boards.data` holds the full `BoardData`: columns + cards) rather than normalized `columns`/`cards` tables — chosen for simplicity and because it matches what the AI reads/writes directly. Chat turns are stored separately in `chat_messages`. DB file + tables are created automatically on startup; `seed_defaults()` seeds the demo user and default board. `DATABASE_PATH` env var controls the file location (Docker uses a named volume at `/data/kanban.db`).

**Board data model** (mirrored by frontend `src/lib/kanban.ts` types and backend `app/schema.py` Pydantic models — keep these in sync when changing the shape):
```ts
type Card = { id: string; title: string; details: string };
type Column = { id: string; title: string; cardIds: string[] };
type BoardData = { columns: Column[]; cards: Record<string, Card> };
```

`Board.version` (an integer counter, separate from `BoardData`) implements optimistic concurrency: `POST /api/kanban` requires the caller's last-seen version and returns 409 on a mismatch instead of silently overwriting a newer save; an AI-driven update via chat also bumps it. `BoardDataModel` additionally rejects any `cardIds` entry that doesn't resolve to a `cards` key (both on manual saves and AI-returned `boardUpdate`s) — this project has no DB migrations tooling, so a `Board`/`BoardData` schema change requires deleting the local `kanban.db` and the Docker `kanban-data` volume to pick up the new columns.

**AI chat flow** (`app/chat.py`): the frontend sends only `{ message }` to `POST /api/chat`. The backend is authoritative — it loads the user's current board and prior `chat_messages` history itself, builds the OpenRouter request (model `openai/gpt-oss-120b`, configurable via `OPENROUTER_MODEL`), and requests a strict JSON-schema structured output: `{ reply: string, boardUpdate: BoardData | null }`. `boardUpdate` is non-null only when the board should change. If the model's response fails to parse/validate, the backend falls back to returning the raw text as `reply` with `boardUpdate: null` — it never partially applies or corrupts board state. Each turn (user + assistant) is persisted to `chat_messages`; `GET /api/chat/history` lets the frontend restore prior turns on reload. On the frontend, a non-null `boardUpdate` in the chat response replaces board state directly (no refetch).

**Schema sharing**: `app/schema.py` holds the Pydantic `BoardData`/`Card`/`Column` models used by both `app/kanban.py` and `app/chat.py` — avoid duplicating board validation logic.

## Coding standards (from root `AGENTS.md`)

- Use latest versions of libraries and idiomatic approaches.
- Keep it simple — no over-engineering, no unnecessary defensive programming, no speculative features.
- No emojis, anywhere.
- When debugging, find the root cause with evidence before fixing — don't guess-and-check.
