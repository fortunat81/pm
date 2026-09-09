# Project Management MVP - Plan

This document is the working plan. The agent checks off items as they are completed.

## Confirmed decisions

- **Auth** - FastAPI session cookie. `/api/auth/login` validates hardcoded `user` / `password`, issues an `HttpOnly` session cookie. All `/api/kanban/*` and `/api/chat/*` routes require it.
- **Serving** - Next.js built to static export, served by FastAPI `StaticFiles` at `/`. All API routes live under `/api`.
- **Frontend-backend sync** - Each board mutation is an immediate POST; the UI updates from the server response (single source of truth).
- **Database** - SQLite via SQLAlchemy 2.x. `users` and `boards` tables exist, but each user has exactly one board for the MVP.
- **AI** - OpenRouter via `openai/gpt-oss-120b`. Non-streaming, single JSON response per turn. Conversation history persisted in SQLite per user. Verify native structured-output support first; fall back to constrained JSON parsing.
- **E2E** - Playwright runs against the full Docker-served integrated stack.
- **One Kanban board** per signed-in user for the MVP.

---

## Part 1: Plan - [x] complete

- [x] Enrich this document with detailed substeps, tests, and success criteria for each part.
- [x] Create `frontend/AGENTS.md` describing the existing frontend code.
- [x] User reviews and approves this plan.

**Success criteria**
- [x] User signs off on this document before Part 2 begins.

---

## Part 2: Scaffolding - [x] complete

Set up Docker infrastructure, FastAPI backend skeleton in `backend/`, and start/stop scripts in `scripts/`.

### Steps

- [x] Create `backend/pyproject.toml` using `uv`, with `fastapi`, `uvicorn`, `pydantic`, `sqlalchemy` dependencies.
- [x] Create `backend/app/main.py` with a FastAPI app and a `/api/health` route returning `{"status": "ok"}`.
- [x] Serve a static "hello world" HTML at `/` via `StaticFiles` (placeholder; real frontend comes in Part 3).
- [x] Create `Dockerfile` at project root: build/install Python deps with `uv`, copy backend, expose port.
- [x] Create `compose.yaml` that runs the container locally.
- [x] Create `scripts/start.sh` (Mac/Linux) and `scripts/start.ps1` (PC), plus matching stop scripts.
- [x] Add a `.dockerignore` and a `.env.example` for `OPENROUTER_API_KEY` (the real `.env` must be created before Part 8).
- [x] Update `backend/AGENTS.md` with a description of the backend structure.

### Tests

- [x] Backend unit test: `/api/health` returns 200 and `{"status": "ok"}`.
- [x] Manual/e2e check: Docker container serves the hello world page at `/` and `/api/health` responds.

### Success criteria

- [x] `scripts/start.ps1` (and `start.sh`) bring up the container; stop scripts tear it down cleanly.
- [x] Visiting `http://localhost:8000/` shows hello world; `http://localhost:8000/api/health` returns JSON.
- [x] `curl http://localhost:8000/api/health` works from the host.

---

## Part 3: Add in Frontend - [x] complete

Statically build and serve the existing Kanban demo at `/`.

### Steps

- [x] Configure `next.config.ts` with `output: "export"` (static export).
- [x] Confirm the demo has no server components/API routes incompatible with static export.
- [x] Refactor backend to a `create_app()` factory that serves the built `frontend/out/` at `/` via `StaticFiles`.
- [x] Make the Docker build multi-stage: Node stage runs `npm ci && npm run build`; Python stage serves the copied `out/`. Removed the hello-world placeholder.
- [x] Remove the now-unneeded `backend/static/` placeholder and update backend/frontend `AGENTS.md` docs.
- [x] Wire Playwright to the Docker-served app (completed in Part 7, per "full e2e wiring when backend is stable").

### Tests

- [x] Frontend unit tests pass (`npm run test:unit`) - 6/6.
- [x] `npm run build` succeeds with static export (output in `frontend/out/`).
- [x] Manual check: Kanban board renders at `/` with 5 columns and the sample cards.
- [x] Backend tests still pass after the `create_app()` refactor - 2/2.

### Success criteria

- [x] The exact demo board from Part 1 (5 columns, rename, add/delete, drag-and-drop) is served at `/` by FastAPI in Docker, with no `next dev` running.

---

## Part 4: Fake user sign-in - [x] complete

Require login with `user` / `password` before seeing the Kanban; allow logout.

### Steps

- [x] Backend: `POST /api/auth/login` validates hardcoded credentials and sets a signed `HttpOnly` session cookie (Starlette `SessionMiddleware` storing the username).
- [x] Backend: `POST /api/auth/logout` clears the session.
- [x] Backend: `GET /api/auth/me` returns the current user or 401.
- [x] Backend: `get_session_user(request)` dependency helper is in place for protecting kanban routes (added in Part 6).
- [x] Frontend: `LoginForm` component (styled per color scheme) and a `Log out` control in the board header.
- [x] Frontend: `AuthGate` calls `/api/auth/me` on load and shows login or the board accordingly.

### Tests

- [x] Backend unit tests (`tests/test_auth.py`): login sets cookie, wrong creds 401, `/me` 401 when logged out and returns user when logged in, logout clears session - 5 tests.
- [x] Frontend tests (`AuthGate.test.tsx`): login form when unauthenticated, board when authenticated, login flow, error on failed login, logout - 5 tests.
- [x] E2E flow verified manually in the Docker-served browser (no Playwright wiring yet - deferred to Part 7).

### Success criteria

- [x] Unauthenticated visit to `/` shows the login screen; after login the Kanban is visible; logout returns to login.
- [x] Session persists across reloads via cookie (verified in browser).

### Notes

- The full API flow was also verified with `curl`: login -> cookie -> `/me` returns `user` -> logout -> `/me` 401.
- The session cookie is stateless (signed, carries username), so no DB session table is needed. Part 6 can swap hardcoded credentials for the `users` table.

---

## Part 5: Database modeling - [x] complete

Propose a database schema, delivered as a JSON design doc, and document the approach in `docs/`.

### Decisions (confirmed with user)

- **Storage**: JSON document per board. `boards.data` holds the full `BoardData` document (columns + cards); chat history in a `chat_messages` table. (Chosen over the fully normalized `columns`/`cards` tables used in the earlier `origin/complete` build, for simplicity and AI fit.)
- **Tooling**: SQLAlchemy 2.x ORM.

### Steps

- [x] Design schema: `users` (id, username unique, password_hash nullable, created_at), `boards` (id, user_id unique FK one-per-user, title, `data` JSON, timestamps), `chat_messages` (id, user_id, board_id, role, content, created_at).
- [x] Decide how the board JSON is stored - single `boards` row with a JSON `data` column holding columns + cards.
- [x] Decide chat storage - `chat_messages` table keyed by user/board with role and content.
- [x] Write the schema proposal to `docs/schema.json` (tables, columns, constraints, indexes, example rows matching `BoardData`).
- [x] Write `docs/database.md` explaining the approach and rationale (JSON-doc vs normalized tradeoff).
- [x] Get user sign-off before implementing.

### Tests

- [x] N/A (design only) - `docs/schema.json` includes example rows matching the frontend `BoardData` shape.

### Success criteria

- [x] User approves `docs/schema.json` and `docs/database.md`.

---

## Part 6: Backend API - [x] complete

Add API routes for reading and changing the Kanban for a user; DB auto-created if missing.

### Steps

- [x] Implement DB engine/session setup (`app/db.py`): SQLAlchemy 2.x models `User`, `Board`, `ChatMessage`; `make_session_factory()` creates the SQLite file + tables on startup; `seed_defaults()` ensures the demo `user` and their default board exist.
- [x] Add `GET /api/kanban` - returns the signed-in user's board (creates a default board if none).
- [x] Add `POST /api/kanban` - replaces/updates the board from the request JSON.
- [x] Use a single `POST` of full board state (`{ "data": BoardData }`) - simplest for the MVP.
- [x] Validate board JSON against the `BoardData` shape using Pydantic (`BoardUpdate`/`BoardDataModel`).
- [x] Protect all kanban routes with the session dependency (`get_session_user`).
- [x] Request-scoped DB sessions wired via `app.state.SessionLocal` + a `get_db` dependency; `create_app` accepts `db_path` for test isolation.
- [x] Docker: `DATABASE_PATH=/data/kanban.db` env + named volume `kanban-data` in `compose.yaml` so the DB persists across container rebuilds.

### Tests

- [x] Backend unit tests (`tests/test_kanban.py`) with temp SQLite DB: default board returned, update persists across requests/sessions, 401 without session, invalid board rejected (422). 5 tests. Full backend suite: 12 pass.

### Success criteria

- [x] `GET /api/kanban` and `POST /api/kanban` work with curl, require auth, and persist to SQLite across restarts.
- [x] New DB file is created automatically.
- [x] Persistence across container restart verified manually via the Docker named volume.

### Notes

- Board data is stored as a JSON document per the Part 5 design (`boards.data`).
- The `user` row is seeded on startup; login is still validated against the hardcoded `user`/`password` for now (Part 6 keeps that from Part 4 - swapping to DB validation is trivial later).

---

## Part 7: Frontend + Backend - [x] complete

Frontend uses the backend API; the app becomes a persistent Kanban board.

### Steps

- [x] `api.ts`: added `getBoard()` and `saveBoard(data)` helpers and a `BoardResponse` type.
- [x] `KanbanBoard`: fetches the board from `GET /api/kanban` on mount (loading state until loaded), and every mutation (rename column, add card, delete card, move card) optimistically updates state and POSTs the new board via `saveBoard`, updating from the server response.
- [x] `KanbanBoard`: handles 401 on load/save by calling `onUnauthorized`, which `AuthGate` uses to return to the login screen.
- [x] Removed the client-side `initialData` seed from the live board path (still exported from `kanban.ts` for tests/fixtures).
- [x] Error banner shown when a save/load fails.

### Tests

- [x] Frontend unit tests updated to mock `@/lib/api` (`KanbanBoard.test.tsx`: load from API, rename persists, add card persists, 401 redirect, save error banner; `AuthGate.test.tsx` covers auth flow with a mocked board) - 13 pass.
- [x] Playwright e2e rewired to run against the Docker-served app (port 8000), signing in via the UI and resetting board state via the API in `beforeEach`; verifies persistence across reload - 4 pass.
- [x] Backend tests still pass (12).

### Success criteria

- [x] Adding/moving/renaming/deleting a card and then reloading the page shows the persisted state. No data is lost on refresh (verified by e2e "persists after reload" and manual Docker curl checks).

---

## Part 8: AI connectivity - [x] complete

Backend makes an AI call via OpenRouter.

### Steps

- [x] Add `OPENROUTER_API_KEY` config (from `.env`).
- [x] Add an OpenRouter client wrapper (HTTP call to `https://openrouter.ai/api/v1/chat/completions`).
- [x] Add `POST /api/chat/test` (or a debug endpoint) that sends "What is 2+2?" and returns the reply.
- [x] Verify whether `openai/gpt-oss-120b` supports structured outputs (response format JSON schema); record the result for Part 9.

### Tests

- [x] Backend test (marked/manual, skips without API key): `2+2` returns a response containing `4`.
- [x] Confirm structured-output support status.

### Success criteria

- [x] `curl` to the test endpoint returns a sensible AI reply for `2+2`, proving OpenRouter connectivity and key loading.

### Notes

- `compose.yaml` gained `env_file: .env` so the real `OPENROUTER_API_KEY` reaches the container.
- `httpx` was promoted from the dev group to runtime dependencies for the OpenRouter client.
- **Structured outputs: CONFIRMED supported.** A live probe with `response_format={"type": "json_schema", "json_schema": {"name": ..., "strict": true, "schema": ...}}` against `openai/gpt-oss-120b` returned valid, parseable JSON (`{"reply": ..., "answer": 4}`). Part 9 can use native structured outputs; a constrained-JSON parse fallback remains a prudent safety net.
- Live `curl` end-to-end: login + `/api/chat/test` returned `"2 + 2 = 4."`. Backend suite: 13 passed, 1 skipped (live chat test skips without the key).

---

## Part 9: AI board updates (Structured Outputs) - [x] complete

Backend always sends the board JSON + user question + history; AI returns a reply plus optional board update.

### Decisions

- **Endpoint**: `POST /api/chat` with body `{ "message": string }`. The backend is the single source of truth: it loads the user's current board and prior `chat_messages` history from the DB itself, builds the request, and returns `{ "reply": string, "boardUpdate": BoardData | null }`. (Part 10's UI only sends the new message; a GET history endpoint belongs to Part 10's "restore on reload".)
- **Structured output**: Part 8 confirmed native JSON-schema structured outputs work. Request `response_format={"type":"json_schema","json_schema":{"name":"kanban_reply","strict":true,"schema":{...}}}` where the schema is `{ reply: string, boardUpdate: BoardData | null }` (nullable `boardUpdate`, not optional, since strict schemas require all keys present; `null` means "no board change").
- **Parse fallback**: if the model's `content` is not valid JSON or fails Pydantic validation, fall back gracefully - return the raw text as `reply` with `boardUpdate: null`, never modify the board, and do not error the request. (Safety net even though structured outputs are supported.)
- **History**: each exchange is persisted in `chat_messages` (user_id, board_id, role user/assistant). Prior rows for the user's board are prepended as conversation context (trimmed to a sane recent window, e.g. last 20 messages, to bound tokens).

### Steps

- [x] Reuse the `BoardDataModel`/`CardModel`/`ColumnModel` validators (from `app/kanban.py`; move/share them so both routers use one definition, or import from a common place).
- [x] Build the JSON schema for the structured output (`reply` string + nullable `boardUpdate` matching `BoardData`), plus a Pydantic model for the parsed result.
- [x] Build the prompt: a `system` instruction ("You manage the user's Kanban board. Return a friendly `reply` and, only if the user asked to change the board, the complete new board in `boardUpdate`; otherwise `null`."), include the current board JSON in context, then prior history, then the user's new message.
- [x] Extend `app/openrouter.py` as needed so the chat result can return structured JSON content (keep `chat()` returning text; parse in the chat service).
- [x] Add the chat service logic (in `app/chat.py`): load user+board, load history, call the model with the structured-output schema, parse + validate the reply, apply `boardUpdate` to `boards.data` when present, persist user message + assistant reply, return `{reply, boardUpdate}`.
- [x] Add a request-scoped DB dependency usage consistent with `app/kanban.py` (`get_db`, `_load_or_create_board`); keep everything auth-protected via `get_session_user`.
- [x] Apply `boardUpdate` to the DB if present (reuse board update path).
- [x] Persist each user message and assistant reply (and applied update) in the `chat_messages` table.

### Tests

- [x] Backend tests with a **mocked AI client** (monkeypatch `app.chat.chat`), isolated temp DB:
  - valid structured reply returns `reply` and applies `boardUpdate` to the board (subsequent `GET /api/kanban` shows the change)
  - `boardUpdate: null` leaves the board unchanged and still returns the reply
  - malformed/non-JSON content falls back gracefully (`boardUpdate: null`, board unchanged, 200)
  - unauthorized request to `POST /api/chat` returns 401
  - history is persisted: two turns create 4 `chat_messages` rows (user/assistant x2)

### Success criteria

- Asking the AI to "add a card" produces a reply and a board update; the update persists and is reflected by the API.
- Live check via curl: log in, `POST /api/chat {"message": "Add a card 'Test AI card' to the Backlog column"}`, then `GET /api/kanban` shows the new card; board resets afterward for test isolation.

### Notes

- New shared `app/schema.py` holds the `BoardData` Pydantic models used by both `kanban.py` and `chat.py` (no duplicate definitions).
- The Part 8 debug route `POST /api/chat/test` was replaced by `POST /api/chat`. Part 8's live `2+2` test was removed in favor of mocked-AI tests here (the key is still required at runtime; connectivity is covered by the live manual check below).
- **Evidence from probes**: strict `json_schema` accepts a required-nullable object field, and it handles the `cards` map (`dict[str, Card]`) correctly - both `strict: true` and `strict: false` returned valid board JSON. `strict: true` is used.
- Live check (container): `POST /api/chat` "Add a card named Study AI card to the Backlog" returned a reply + full `boardUpdate`; `GET /api/kanban` confirmed `card-9` persisted. A follow-up no-change request returned `boardUpdate: null`. `chat_messages` grew to 4 rows (user/assistant x2). Backend suite: 19 passed.

---

## Part 10: AI chat sidebar - [x] complete

Beautiful sidebar widget for full AI chat; LLM can update the board; UI refreshes automatically on update.

### Decisions

- **Backend additions**: `GET /api/chat/history` returns the signed-in user's prior `chat_messages` as `{ messages: {role, content}[] }` (chronological), so the UI can restore history on reload. `POST /api/chat` already exists (Part 9) and returns `{ reply, boardUpdate }`.
- **Frontend data flow**: the sidebar sends only `{ message }` to `POST /api/chat` (the backend already injects board + history context). When the response includes a non-null `boardUpdate`, the UI replaces its board state with it (single source of truth = server) rather than refetching. This keeps the Kanban instantly in sync with what the AI changed.
- **Chat history in the sidebar**: on mount, fetch `GET /api/chat/history` and render prior turns; new turns are appended optimistically from the local request/response.
- **Message model**: `ChatMessage = { role: "user" | "assistant"; content: string }`; the sidebar is purely presentational + network — it does not own the board.

### Steps

- [x] Backend: add `GET /api/chat/history` (auth-protected) returning prior `chat_messages` rows for the user's board.
- [x] Backend test for the history endpoint (auth required; returns seeded history chronologically).
- [x] Frontend `api.ts`: add `ChatMessage`, `ChatResponse = { reply, boardUpdate: BoardData | null }`, `HistoryResponse`, and `chat(message)` + `getChatHistory()` helpers.
- [x] Frontend: build `ChatSidebar` component — message list (user + assistant bubbles), text input + send button, loading/disabled state while awaiting a reply, error surface for failed sends.
- [x] Frontend: style per color scheme (accent yellow accents, primary blue links/user, secondary purple submit, navy headings, gray supporting text) consistent with the existing board UI.
- [x] Frontend: wire the sidebar into the board layout — KanbanBoard lays out the Kanban columns and the chat sidebar side-by-side (responsive stack).
- [x] Frontend: on a chat response, if `boardUpdate` is non-null, `setBoard(boardUpdate)`; if the response is 401, call `onUnauthorized`.
- [x] Frontend: on mount, restore prior history via `getChatHistory()`.

### Tests

- [x] Frontend unit tests for `ChatSidebar` (mock `@/lib/api`): renders history, sends a message and shows the reply, applies a returned `boardUpdate` via an `onBoardUpdate` callback, shows an error on failure.
- [x] Frontend `KanbanBoard` test: rendering includes the sidebar; a chat `boardUpdate` replaces the board.
- [x] E2E: ask the AI to add/move a card in the sidebar, assert the board updates in the UI.
- [x] Full integration run: all backend + frontend unit + e2e tests pass against the Docker-served stack.

### Success criteria

- User can chat with the AI; when the AI returns a board update, the Kanban board refreshes automatically without a manual reload.
- Chat history persists across a page reload (restored from the backend).

### Notes

- Layout: the board header stays full width; below it, the 5-column board grid and a sticky `AI Assistant` sidebar sit side-by-side on wide screens (`2xl:grid-cols-5` + 360px sidebar) and stack on smaller ones.
- e2e drag test needed a wider viewport (1680px) once the sidebar joined the layout so the 5 columns still render in one row with stable drag geometry.
- **Bug found + fixed (root cause via evidence)**: a live "move card" chat call returned 500. Logs showed `AiReplyModel` ValidationError - the model can emit `content: null` (OpenRouter null content field), so `chat()` returned `None`, and the parse fallback `AiReplyModel(reply=raw, ...)` got `reply=None`. Fix: `app/openrouter.py` coerces null/empty content to `""`, and the fallback substitutes a safe message for empty content. Regression test added (`test_chat_null_content_returns_safe_reply`).
- Live check in the browser: asked the AI to move a card to Done - the board updated automatically (card moved from Backlog to Done) with no manual reload, history restored on reload.
- Backend suite: 23 passed. Frontend unit: 21 passed. e2e: 5 passed.