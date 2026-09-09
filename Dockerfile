# Stage 1: build the Next.js frontend (static export)
FROM node:22-bookworm-slim AS frontend-build

WORKDIR /build

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# Stage 2: Python backend that serves the built frontend
FROM ghcr.io/astral-sh/uv:python3.14-bookworm-slim

ENV UV_COMPILE_BYTECODE=1
ENV UV_LINK_MODE=copy
ENV FRONTEND_STATIC=/app/frontend/out
ENV DATABASE_PATH=/data/kanban.db

WORKDIR /app

COPY backend/pyproject.toml ./
RUN uv sync

COPY backend/ ./
COPY --from=frontend-build /build/out ./frontend/out

EXPOSE 8000

CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
