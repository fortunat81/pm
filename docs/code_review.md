# Code Review - Project Management MVP

Date: 2026-09-08
Scope: `backend/`, `frontend/`, `Dockerfile`, `compose.yaml`, `scripts/`, `docs/`
Method: full source read + test review + Docker/infra check against `AGENTS.md` business requirements and coding standards.

## Summary

The MVP meets all business requirements: sign-in, persistent Kanban (rename columns, add/delete/move cards, drag-drop), AI sidebar with create/edit/move via structured outputs. Architecture (FastAPI serving static Next.js export, SQLite JSON-doc board, OpenRouter `openai/gpt-oss-120b`) matches `docs/PLAN.md` Parts 1-10. Test coverage is good (backend 23, frontend 21, e2e 5 per PLAN notes).

Main risks: reproducible builds (lockfile ignored), session secret default, frontend save races, unhandled load/logout errors, missing card-edit UI vs spec, no rate limiting on paid AI endpoint.

No emojis found. No root README exists.

## Strengths

- Correct static-export serving: `frontend/next.config.ts:4` (`output: "export"`), `backend/app/main.py:41` mounts `StaticFiles(html=True)` after API routers.
- Board persistence correct for single-user MVP: `backend/app/db.py:88-90` (`UNIQUE(user_id)` enforces 1 board/user), named volume `compose.yaml:10-11`, `DATABASE_PATH=/data/kanban.db` in `Dockerfile:18`.
- AI structured outputs confirmed working with parse fallback (`backend/app/chat.py:177-185`), null-content regression fixed and tested.
- Pure `moveCard` in `frontend/src/lib/kanban.ts`, 409 handling intent, dangling-card filter, e2e board reset via API, color scheme matches spec (`#ecad0a/#209dd7/#753991/#032147/#888888`).
- Root-cause discipline evidenced in `docs/PLAN.md:309`.

---

## Critical / High

### H1 - Docker ignores `uv.lock`, unpinned deps (reproducibility)
`Dockerfile:22-23`, `backend/pyproject.toml:6-13`, `backend/uv.lock`
`COPY backend/pyproject.toml` then `RUN uv sync` without lockfile; deps are bare (`fastapi`, `sqlalchemy`, `httpx`). Every build floats to latest.
Recommendation:
```
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --locked --no-dev
```
Add minimum bounds in `pyproject.toml`. Remove duplicate `httpx` from `dev` group (`pyproject.toml:18`).

### H2 - Hardcoded session secret in production
`backend/app/main.py:15-17`, `compose.yaml:1-11`, `.env.example:1-2`
Defaults to `"dev-secret-change-me-in-production"`, never set in Docker/env example. Anyone can forge the Starlette session cookie.
Recommendation: fail fast if unset in prod (or ephemeral random at startup), add `SESSION_SECRET=` to `.env.example`, wire through `compose.yaml`.

### H3 - Frontend concurrent saves lose updates
`frontend/src/components/KanbanBoard.tsx:43-73,75-97,202-212`
Two `mutate()` calls before first `saveBoard` resolves send the same `versionRef`; second gets 409, refetches, drops its own change. In-flight `persist` can also clobber an AI `boardUpdate`. Side effects inside `setState` updater double-fire under React 19 StrictMode.
Recommendation: compute `next` from current state/ref (no side effects in updater), serialize saves (promise queue / `isSaving` + pending buffer), ignore stale resolutions by token, retry pending change after 409 instead of discarding.

### H4 - Load failure is invisible
`frontend/src/components/KanbanBoard.tsx:125,216-224`
`error` is set on `getBoard()` failure but the `board === null` early return only renders "Loading board...". Non-401 load failure = infinite spinner, no retry.
Recommendation: render `error` + retry button in the `board===null` branch. Clear `error` on successful `persist` and at start of `mutate` (`KanbanBoard.tsx:32,69,211` currently only cleared in `handleBoardUpdate`).

### H5 - No rate limiting on login / paid AI endpoint
`backend/app/auth.py:23-28`, `backend/app/chat.py:152-196`
Unlimited `POST /api/chat` spends OpenRouter money; login has no brute-force throttle.
Recommendation: per-session/IP limiter (e.g. `slowapi`) on both routes + `Field(min_length=1, max_length=4000)` on `ChatBody.message` (`backend/app/chat.py:33-34`, currently accepts empty/megabyte strings).

### H6 - Missing card-edit UI vs spec
`frontend/src/components/KanbanCard.tsx:1-53`, `AGENTS.md:9`
Spec requires cards "can be moved ... and edited". Only add/delete/rename/move exist.
Recommendation: confirm scope; if required, add edit form (reuse `NewCardForm` pattern) + persist + tests.

## Medium

### Backend
- **M1 - Lost-update race is check-then-set, not atomic.** `backend/app/kanban.py:60-67`, `backend/app/chat.py:79-85`. Acceptable single-user-local, but document or use atomic `UPDATE ... WHERE version=:old` + 409 on rowcount 0. Chat path bumps version with no check by design.
- **M2 - Two commits in chat can diverge.** `backend/app/chat.py:187-188`. Board commit then history commit; second failure = board changed, history lost. Recommendation: single transaction.
- **M3 - `response.json()` unhandled -> 500.** `backend/app/openrouter.py:66`. Only `httpx.HTTPError` caught. Wrap in `try/except ValueError` -> `OpenRouterError`.
- **M4 - Upstream error body echoed to client.** `backend/app/openrouter.py:61-64` -> `backend/app/chat.py:167-168`. Log full body server-side, return generic "AI service unavailable".
- **M5 - History flattened into one user blob.** `backend/app/chat.py:63-76`. Loses role separation, no token cap beyond 20 rows. Emit proper `system`/`user`/`assistant` turns, cap total chars.
- **M6 - Silent AI validation failures.** `backend/app/chat.py:177-185`. Add `logging.warning` (truncated payload) before fallback.
- **M7 - Board schema under-validates AI output.** `backend/app/schema.py:31-41`. Only dangling `cardIds` rejected; dup column ids, dup placement, orphan cards, `cards[key].id != key` pass. Add validators or document gap.
- **M8 - Static mount can shadow `/api` 404s.** `backend/app/main.py:41`. Add test: unknown `/api/...` returns JSON 404, not `index.html`.
- **M9 - Import-time side effects.** `backend/app/main.py:29-31,45`. `create_app()` connects/seeds + `StaticFiles()` raises if `frontend/out` missing at import. Move seeding to lifespan, validate `static_dir` lazily with clear error. Also close seeded session (`session.close()` in `finally`).
- **M10 - Dead `password_hash` + stale comment.** `backend/app/db.py:80`, `backend/app/auth.py:4-6`. Column exists, auth uses hardcoded constants. Implement DB auth or drop column + fix comment.
- **M11 - Session cookie insecure defaults.** `backend/app/main.py:24`. Add `same_site="lax"`, explicit `max_age`, `https_only` when applicable.
- **M12 - `extra="forbid"` brittle to frontend evolution.** `backend/app/schema.py:10,18,26`. Keep if versioned together, else `ignore` with comment.
- **M13 - Missing-config mapped to 502.** `backend/app/openrouter.py:39-41`. Unset key is 500/503 "AI service not configured", not 502.

### Frontend
- **M14 - `AuthGate` logout unhandled rejection.** `frontend/src/components/AuthGate.tsx:44-48`. Wrap in `try/finally`, always clear to anonymous.
- **M15 - No keyboard DnD, weak focus.** `KanbanBoard.tsx:37-41` (only `PointerSensor`), `globals.css:32-34` (`outline-none`). Add `KeyboardSensor` + announcements, visible `:focus-visible` ring.
- **M16 - Missing form labels.** `NewCardForm.tsx:27-44` (placeholder only), `KanbanColumn.tsx:42-47` (identical `aria-label="Column title"`). Use `<label>` / `aria-label={Rename ${title} column}`.
- **M17 - Chat input blocked while sending.** `ChatSidebar.tsx:19-23,131-137`. E2E allows 90s. Gate only submit, keep input enabled.
- **M18 - History 401 inconsistent.** `ChatSidebar.tsx:25-42` shows "Could not load" instead of `onUnauthorized` like board/chat paths. Call `onUnauthorized` on 401.
- **M19 - Empty column title allowed.** `KanbanBoard.tsx:152-163`. Trim + reject empty rename.
- **M20 - No `onDragCancel`.** `KanbanBoard.tsx:138-150`. `activeCardId` sticks on Esc. Add `onDragCancel={() => setActiveCardId(null)}`.
- **M21 - `SortableContext` includes dangling ids.** `KanbanColumn.tsx:51` vs `KanbanBoard.tsx:306-308` filter. Use `items={cards.map(c=>c.id)}`.
- **M22 - Whole card is drag handle.** `KanbanCard.tsx:29-31`. Impairs text selection, no SR handle description. Separate handle or `aria-roledescription`.
- **M23 - `api.ts` sloppiness.** `src/lib/api.ts:24-32` (`{...init}` can override credentials, always sends CT on GET), `:44-51` (`statusText` often blank -> blank login error). Merge headers explicitly, fallback to `API request failed (${status})`.
- **M24 - `LoginForm` double-submit.** `LoginForm.tsx:15-27`. No guard/disabled inputs while `isSubmitting`.
- **M25 - Lint/typecheck scripts broken.** `package.json:10` (`"lint": "eslint"` no path), no `typecheck`. Use `"lint": "eslint .", "typecheck": "tsc --noEmit"`.
- **M26 - `npm run start` broken for export.** `next.config.ts:3-5` + `package.json:7-8`. `next start` does not serve `output: "export"` (own `AGENTS.md:15` warns). Remove/replace script.

### Infra / Docs
- **M27 - `.env.example` incomplete.** Only `OPENROUTER_API_KEY`; code uses `SESSION_SECRET`, `DATABASE_PATH`, `FRONTEND_STATIC`, `OPENROUTER_MODEL`. Document optional vars with defaults.
- **M28 - Schema docs drift.** `docs/schema.json:28-50` lacks `boards.version` present in `backend/app/db.py:93` and API contract (`frontend/src/lib/api.ts:4,8-12`). Update `schema.json` + `docs/database.md` with optimistic concurrency. Also `database.md:37-39` says Part 6 validates against `users` table; reality is hardcoded check (`backend/app/auth.py:4-6`, `docs/PLAN.md:169`). Clarify.
- **M29 - No root README.** Only stale `frontend/README.md` (`Kanban Studio`, `npm run dev` only, no Docker URL/creds/env/e2e prereq). Add ~20-line root `README.md` (start/stop, URL, `user`/`password`, `.env` copy, e2e prereq) and refresh frontend one.
- **M30 - Dev deps in prod image, runs as root, no healthcheck.** `Dockerfile:23` (`uv sync` installs pytest), no `USER`, no `HEALTHCHECK` despite `/api/health`. Add `--no-dev`, non-root user (with `/data` write), `HEALTHCHECK` or compose healthcheck.

## Low

- Backend: non-constant-time credential compare (`auth.py:25` -> `hmac.compare_digest`); `logout` only pops one key (`auth.py:31-34` -> `session.clear()`); shared mutable `DEFAULT_BOARD_DATA` (`db.py:14-68,130-132` -> `copy.deepcopy`); history GET creates board as side effect (`chat.py:122-129`); 1.x `Column` idiom vs 2.x `Mapped/mapped_column` (`db.py:75-106`); no relationships/cascades; private cross-module imports (`chat.py:15` -> shared `deps.py`); `seed_defaults` races/always commits (`db.py:121-133` -> catch `IntegrityError`, commit only when added); `requires-python >=3.13` excludes 3.11/3.12 for no reason, Dockerfile uses 3.14.
- Frontend: `ApiError` missing `name` (`api.ts:15-22`); `createId` uses `Math.random()+Date.now()` (`kanban.ts:164-168` -> `crypto.randomUUID()`); missing `"use client"` in `KanbanColumn`/`NewCardForm`; `AuthGate` treats offline as anonymous (`AuthGate.tsx:16-33`); `next/font/google` needs network at build; e2e drag via raw mouse coords brittle (`tests/kanban.spec.ts:112-134`), live-AI e2e flaky/costly (keep one smoke, mock rest); `playwright.config.ts:10-11` no `webServer` (document Docker prerequisite); `globals.css:21-23` duplicate `box-sizing` vs Tailwind preflight; `event.active.id as string` (`KanbanBoard.tsx:134` -> `String(...)`); chat `key={index}` (`ChatSidebar.tsx:111`), local `ChatRole` dup (`ChatSidebar.tsx:8` -> import from `api.ts`); missing `aria-live` on chat, `scrollTo smooth` on every message.
- Infra: `.env:3` holds live `sk-or-v1-...` (correctly gitignored via `.gitignore:132` + `.dockerignore:2`, injected via `compose.yaml:6-7`, but rotate if ever committed; remove stale TODO comment); `compose.yaml:6-7` hard-requires `.env` (document `copy .env.example .env` or `required: false`); `start.ps1`/`stop.ps1` lack `$ErrorActionPreference="Stop"` (parity with `start.sh:2`); verify exec bit on `start.sh`/`stop.sh`; `scripts/AGENTS.md:1` is placeholder stub; `.gitignore:1-178` is full generic template (~150 dead lines, violates simplicity - trim to ~20 used); `CMD ["uv", "run", ...]` works but `CMD [".venv/bin/uvicorn", ...]` is idiomatic prod.

## Test gaps (all suites green, gaps remain)

Backend (`backend/tests/`): OpenRouter failure -> 502 (not 500); chat-driven `version` bump then stale manual save -> 409; empty/oversize message -> 422 (after M5 fix); extra-key/missing-`reply` fallback (only dangling-`cardIds` covered in `test_chat.py:200`); unknown `/api/...` -> JSON 404; login missing-fields -> 422, wrong-username -> 401 (only wrong-password in `test_auth.py:23`).
Frontend: `kanban.test.ts` only 3 cases (add same-column/empty-column/unknown-id/immutability); no `api.ts`, `LoginForm`, `NewCardForm`, `KanbanColumn` unit tests; no 409/debounce/drag tests in `KanbanBoard.test.tsx`.

## Recommended fix order

1. Dockerfile: `uv.lock` + `--locked --no-dev` (30 min, reproducibility + image size).
2. Session secret: document + wire + fail-fast (30 min, security).
3. Frontend: loading-error branch, logout catch, error-clear (30 min).
4. Frontend: pure updater + serialized saves (half day, biggest correctness win).
5. Backend: rate limit + message length, single chat transaction, `response.json()` catch, generic 502 body (half day).
6. Docs: `schema.json`/`database.md` version column, `.env.example` optional vars, root README + frontend README refresh, trim `.gitignore` (1 hr).
7. A11y + card-edit scope decision + missing unit tests (half day each).
