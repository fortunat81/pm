# Frontend

A Next.js (App Router) single-board Kanban app with an AI chat sidebar. It is built as a static export and served by the FastAPI backend (see the Docker setup at the repo root). Since Part 7 the board loads from and persists to the backend API (`/api/kanban`); since Part 10 the AI Assistant sidebar chats via `POST /api/chat` and applies board updates returned by the AI.

## Stack

- Next.js 16 (App Router), React 19, TypeScript
- Tailwind CSS 4 (via `@tailwindcss/postcss`)
- `@dnd-kit/core` + `@dnd-kit/sortable` for drag-and-drop
- Vitest + Testing Library (unit), Playwright (e2e)

## Build / serving model

- `next.config.ts` sets `output: "export"`, so `npm run build` produces a static site in `out/`.
- The Docker image builds this static export in a Node stage, then the Python/FastAPI stage serves `out/` at `/`. Do not run `next start` in production; the backend serves the files.
- Playwright e2e runs against the Docker-served app on port 8000 (see `playwright.config.ts`; no embedded webServer). The e2e suite resets board state via the API in `beforeEach`.

## Structure

- `src/app/layout.tsx` - root layout, loads Google fonts (Space Grotesk + Manrope), imports `globals.css`
- `src/app/page.tsx` - renders `AuthGate` at `/`
- `src/app/globals.css` - Tailwind import + color scheme CSS variables
- `src/components/AuthGate.tsx` - checks `/api/auth/me` on load; shows `LoginForm` when anonymous, `KanbanBoard` when authenticated; wires login/logout and passes `onUnauthorized` to the board
- `src/components/LoginForm.tsx` - sign-in form (username + password)
- `src/components/KanbanBoard.tsx` - top-level board; fetches the board from the API on mount, owns DnD + mutation handlers, persists every change via `saveBoard` (tracking a `version` ref for optimistic-concurrency conflict detection - a 409 refetches the latest board instead of overwriting it), handles 401 via `onUnauthorized`; column-title renames are debounced (400ms) so typing doesn't POST per keystroke; filters out any card id that doesn't resolve (defense-in-depth against a malformed board); optional `username`/`onLogout` show a user badge + Log out button; lays out the board columns and the `ChatSidebar` together, applying a returned AI `boardUpdate` (+ its `version`) to the board
- `src/components/ChatSidebar.tsx` - AI chat widget (message list, input, send); restores history from `getChatHistory` on mount, sends via `api.chat`, calls `onBoardUpdate` when the AI returns a board update, `onUnauthorized` on 401
- `src/components/KanbanColumn.tsx` - single column; rename input, card list, `NewCardForm`
- `src/components/KanbanCard.tsx` - sortable card with remove button
- `src/components/KanbanCardPreview.tsx` - drag overlay card
- `src/components/NewCardForm.tsx` - add-a-card form (toggle open/closed)
- `src/lib/api.ts` - fetch helpers for `/api/auth/*`, `/api/kanban`, and `/api/chat` (`me`, `login`, `logout`, `getBoard`, `saveBoard`, `chat`, `getChatHistory`), `ApiError`, same-origin credentials
- `src/lib/kanban.ts` - types (`Card`, `Column`, `BoardData`), pure helpers `moveCard`/`createId`, and `initialData` (fixture/seed data only)
- Tests: `src/lib/kanban.test.ts`, `src/components/ChatSidebar.test.tsx`, `src/components/KanbanBoard.test.tsx` + `AuthGate.test.tsx` (all mock `@/lib/api`), `tests/kanban.spec.ts` (Playwright e2e)

## Data model (client only)

```ts
type Card = { id: string; title: string; details: string };
type Column = { id: string; title: string; cardIds: string[] };
type BoardData = { columns: Column[]; cards: Record<string, Card> };
```

`BoardResponse`/`ChatResponse` (`src/lib/api.ts`) also carry a `version: number` alongside `data`/`boardUpdate` - the backend's optimistic-concurrency counter, used to detect (and recover from) a save that landed after the board changed elsewhere.

`KanbanBoard` holds a single `BoardData` in `useState`, loaded from `GET /api/kanban` (the backend seeds the default 5-column/8-card board). `initialData` is a fixture used by tests only. All manual mutations (rename column, add card, delete card, move card) persist via `saveBoard`; an AI `boardUpdate` replaces the board state from the server response.

## Scripts

- `npm run dev` - dev server
- `npm run build` / `npm run start` - production build/start
- `npm run lint` - ESLint
- `npm run test` / `npm run test:unit` - Vitest unit tests
- `npm run test:e2e` - Playwright
- `npm run test:all` - unit + e2e

## Conventions

- Path alias `@/` maps to `src/` (configured in `tsconfig.json` and `vitest.config.ts`).
- Colors come from CSS variables in `globals.css` (accent yellow, primary blue, secondary purple, dark navy, gray text) - see root `AGENTS.md` for the palette.
- Components use `data-testid` attributes (`column-<id>`, `card-<id>`, `chat-messages`) for tests.
- e2e uses a wide viewport (1680px) so the 5 columns render beside the sidebar and drag geometry stays stable.
