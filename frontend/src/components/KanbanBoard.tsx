"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { KanbanColumn } from "@/components/KanbanColumn";
import { KanbanCardPreview } from "@/components/KanbanCardPreview";
import { ChatSidebar } from "@/components/ChatSidebar";
import { createId, moveCard, type BoardData, type Card } from "@/lib/kanban";
import { api, ApiError } from "@/lib/api";

type KanbanBoardProps = {
  username?: string;
  onLogout?: () => void;
  onUnauthorized?: () => void;
};

export const KanbanBoard = ({
  username,
  onLogout,
  onUnauthorized,
}: KanbanBoardProps) => {
  const [board, setBoard] = useState<BoardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const versionRef = useRef(1);
  const renameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    })
  );

  const persist = useCallback(
    async (next: BoardData) => {
      try {
        const saved = await api.saveBoard(next, versionRef.current);
        versionRef.current = saved.version;
        setBoard(saved.data);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          onUnauthorized?.();
          return;
        }
        if (err instanceof ApiError && err.status === 409) {
          // Someone else (a manual save, or the AI) changed the board first;
          // resync instead of silently discarding that other change.
          try {
            const latest = await api.getBoard();
            versionRef.current = latest.version;
            setBoard(latest.data);
            setError(
              "Your board changed elsewhere. Refreshed to the latest version."
            );
          } catch {
            setError("Could not save changes. Please try again.");
          }
          return;
        }
        setError("Could not save changes. Please try again.");
      }
    },
    [onUnauthorized]
  );

  const mutate = useCallback(
    (updater: (prev: BoardData) => BoardData, options?: { debounceMs?: number }) => {
      setBoard((prev) => {
        if (!prev) {
          return prev;
        }
        const next = updater(prev);
        if (options?.debounceMs) {
          if (renameTimerRef.current) {
            clearTimeout(renameTimerRef.current);
          }
          renameTimerRef.current = setTimeout(() => {
            renameTimerRef.current = null;
            void persist(next);
          }, options.debounceMs);
        } else {
          void persist(next);
        }
        return next;
      });
    },
    [persist]
  );

  useEffect(() => {
    return () => {
      if (renameTimerRef.current) {
        clearTimeout(renameTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .getBoard()
      .then((response) => {
        if (!cancelled) {
          versionRef.current = response.version;
          setBoard(response.data);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) {
          return;
        }
        if (err instanceof ApiError && err.status === 401) {
          onUnauthorized?.();
          return;
        }
        setError("Could not load your board.");
      });
    return () => {
      cancelled = true;
    };
  }, [onUnauthorized]);

  const cardsById = useMemo(() => board?.cards ?? {}, [board]);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveCardId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveCardId(null);

    if (!over || active.id === over.id) {
      return;
    }

    mutate((prev) => ({
      ...prev,
      columns: moveCard(prev.columns, active.id as string, over.id as string),
    }));
  };

  const handleRenameColumn = (columnId: string, title: string) => {
    mutate(
      (prev) => ({
        ...prev,
        columns: prev.columns.map((column) =>
          column.id === columnId ? { ...column, title } : column
        ),
      }),
      // Debounce so a rename doesn't POST on every keystroke.
      { debounceMs: 400 }
    );
  };

  const handleAddCard = (columnId: string, title: string, details: string) => {
    mutate((prev) => {
      const id = createId("card");
      return {
        ...prev,
        cards: {
          ...prev.cards,
          [id]: { id, title, details: details || "No details yet." },
        },
        columns: prev.columns.map((column) =>
          column.id === columnId
            ? { ...column, cardIds: [...column.cardIds, id] }
            : column
        ),
      };
    });
  };

  const handleDeleteCard = (columnId: string, cardId: string) => {
    mutate((prev) => {
      return {
        ...prev,
        cards: Object.fromEntries(
          Object.entries(prev.cards).filter(([id]) => id !== cardId)
        ),
        columns: prev.columns.map((column) =>
          column.id === columnId
            ? {
                ...column,
                cardIds: column.cardIds.filter((id) => id !== cardId),
              }
            : column
        ),
      };
    });
  };

  const handleBoardUpdate = useCallback((next: BoardData, version: number) => {
    // The AI's update already landed server-side; drop any pending debounced
    // rename so it doesn't fire against the now-stale version.
    if (renameTimerRef.current) {
      clearTimeout(renameTimerRef.current);
      renameTimerRef.current = null;
    }
    versionRef.current = version;
    setBoard(next);
    setError(null);
  }, []);

  const activeCard = activeCardId ? cardsById[activeCardId] : null;

  if (board === null) {
    return (
      <div className="grid min-h-screen place-items-center">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[var(--gray-text)]">
          Loading board...
        </p>
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden">
      <div className="pointer-events-none absolute left-0 top-0 h-[420px] w-[420px] -translate-x-1/3 -translate-y-1/3 rounded-full bg-[radial-gradient(circle,_rgba(32,157,215,0.25)_0%,_rgba(32,157,215,0.05)_55%,_transparent_70%)]" />
      <div className="pointer-events-none absolute bottom-0 right-0 h-[520px] w-[520px] translate-x-1/4 translate-y-1/4 rounded-full bg-[radial-gradient(circle,_rgba(117,57,145,0.18)_0%,_rgba(117,57,145,0.05)_55%,_transparent_75%)]" />

      <main className="relative mx-auto flex min-h-screen max-w-[1800px] flex-col gap-10 px-6 pb-16 pt-12">
        {error && (
          <div
            role="alert"
            className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700"
          >
            {error}
          </div>
        )}
        <header className="flex flex-col gap-6 rounded-[32px] border border-[var(--stroke)] bg-white/80 p-8 shadow-[var(--shadow)] backdrop-blur">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-[var(--gray-text)]">
                Single Board Kanban
              </p>
              <h1 className="mt-3 font-display text-4xl font-semibold text-[var(--navy-dark)]">
                Kanban Studio
              </h1>
              <p className="mt-3 max-w-xl text-sm leading-6 text-[var(--gray-text)]">
                Keep momentum visible. Rename columns, drag cards between stages,
                and capture quick notes without getting buried in settings.
              </p>
            </div>
            <div className="flex flex-col items-end gap-3">
              <div className="flex items-center gap-3">
                {username && (
                  <span className="text-sm font-semibold text-[var(--primary-blue)]">
                    {username}
                  </span>
                )}
                {onLogout && (
                  <button
                    type="button"
                    onClick={onLogout}
                    className="rounded-full border border-[var(--stroke)] bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--gray-text)] transition hover:border-[var(--primary-blue)] hover:text-[var(--navy-dark)]"
                  >
                    Log out
                  </button>
                )}
              </div>
              <div className="rounded-2xl border border-[var(--stroke)] bg-[var(--surface)] px-5 py-4">
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[var(--gray-text)]">
                  Focus
                </p>
                <p className="mt-2 text-lg font-semibold text-[var(--primary-blue)]">
                  One board. Five columns. Zero clutter.
                </p>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            {board.columns.map((column) => (
              <div
                key={column.id}
                className="flex items-center gap-2 rounded-full border border-[var(--stroke)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--navy-dark)]"
              >
                <span className="h-2 w-2 rounded-full bg-[var(--accent-yellow)]" />
                {column.title}
              </div>
            ))}
          </div>
        </header>

        <div className="flex flex-col gap-8 xl:flex-row">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <section className="grid flex-1 gap-6 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
              {board.columns.map((column) => (
                <KanbanColumn
                  key={column.id}
                  column={column}
                  cards={column.cardIds
                    .map((cardId) => board.cards[cardId])
                    .filter((card): card is Card => Boolean(card))}
                  onRename={handleRenameColumn}
                  onAddCard={handleAddCard}
                  onDeleteCard={handleDeleteCard}
                />
              ))}
            </section>
            <DragOverlay>
              {activeCard ? (
                <div className="w-[260px]">
                  <KanbanCardPreview card={activeCard} />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>

          <div className="h-[560px] w-full shrink-0 xl:h-[calc(100vh-9rem)] xl:w-[360px] xl:self-start xl:sticky xl:top-8">
            <ChatSidebar
              onBoardUpdate={handleBoardUpdate}
              onUnauthorized={onUnauthorized}
            />
          </div>
        </div>
      </main>
    </div>
  );
};
