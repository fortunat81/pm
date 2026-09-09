# Database approach

This proposal is for the MVP and targets SQLite, using SQLAlchemy 2.x ORM.

## Decision

Store each user's entire Kanban board as a **single JSON document** in a `boards.data`
column, rather than fully normalized `columns`/`cards` tables. Chat history lives in a
separate `chat_messages` table.

## Why JSON per board (vs. normalized tables)

The MVP works with the board as one atomic `BoardData` document:

- The frontend already models the board as `{ columns: Column[]; cards: Record<string, Card> }`,
  where `Column.cardIds` is an ordered list and `cards` is a keyed map.
- The AI feature (Parts 8-10) sends the whole board JSON as context and (via structured
  outputs) returns an optional full board update. Round-tripping the document as-is is the
  least-effort, least-error-prone path.
- Every board mutation (drag, rename, add/delete card) currently produces a new full
  `BoardData`; persisting the whole document on each change is a single write.

Normalized tables (as in the earlier `origin/complete` build) add per-card/column rows,
integer `position` columns, and multi-row reads/writes. That buys per-card queries that the
MVP does not need, at meaningful extra code. Per the project's "keep it simple" standard, the
JSON document is the right fit. If the product later needs per-card analytics or multi-board
sharing, the schema can be migrated (e.g. normalize `data` into rows) behind the API.

## Tables

### users
- `id` INTEGER primary key
- `username` TEXT, unique, not null
- `password_hash` TEXT, nullable (plaintext demo password until hashing is chosen)
- `created_at` TEXT default CURRENT_TIMESTAMP

The MVP seeds a single `user` row (validated at login in Part 6). Multiple users are
supported by the schema for the future; the hardcoded `user`/`password` check is replaced by
a lookup against this table.

### boards
- `id` INTEGER primary key
- `user_id` INTEGER, not null, foreign key -> users(id)
- `title` TEXT, not null, default 'My Board'
- `data` JSON, not null - the full `BoardData` document
- `created_at` / `updated_at`

A `UNIQUE(user_id)` constraint enforces **one board per user** for the MVP. Column/card order
is captured by the JSON (array order and `cardIds`), so no separate position columns are
needed.

### chat_messages
- `id` INTEGER primary key
- `user_id` INTEGER, not null, foreign key -> users(id)
- `board_id` INTEGER, nullable, foreign key -> boards(id)
- `role` TEXT, not null ('user' | 'assistant')
- `content` TEXT, not null
- `created_at`

Stores full conversation history per user/board for the AI chat feature.

## Board document shape (frontend `BoardData`)

```jsonc
{
  "columns": [
    { "id": "col-backlog", "title": "Backlog", "cardIds": ["card-1", "card-2"] }
    // ...each column: { id, title, cardIds }
  ],
  "cards": {
    "card-1": { "id": "card-1", "title": "Align roadmap themes", "details": "..." }
    // ...keyed by card id: { id, title, details }
  }
}
```

## Ordering strategy

Order is implicit in the JSON: `columns` array order is column order, and each
`Column.cardIds` array is that column's card order. No explicit `position` integers.

## Migration approach

- Create all tables on startup with `CREATE TABLE IF NOT EXISTS` (SQLAlchemy
  `Base.metadata.create_all`); SQLite file is created automatically if missing.
- No versioned migration framework is needed for the MVP. For schema evolution, see the
  note under "Decision" - normalize in place behind the API.

## JSON schema reference

See `docs/schema.json` for the machine-readable table/column definitions and example rows
that match the frontend `BoardData`.
