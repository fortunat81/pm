"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import clsx from "clsx";
import { api, ApiError, type ChatMessage } from "@/lib/api";
import type { BoardData } from "@/lib/kanban";

type ChatRole = "user" | "assistant";

type ChatSidebarProps = {
  onBoardUpdate?: (board: BoardData, version: number) => void;
  onUnauthorized?: () => void;
};

export const ChatSidebar = ({
  onBoardUpdate,
  onUnauthorized,
}: ChatSidebarProps) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getChatHistory()
      .then((response) => {
        if (!cancelled) {
          setMessages(response.messages);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError("Could not load chat history.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const node = scrollRef.current;
    if (node && typeof node.scrollTo === "function") {
      node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
    }
  }, [messages, isSending]);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const text = draft.trim();
      if (!text || isSending) {
        return;
      }

      setDraft("");
      setError(null);
      setMessages((prev) => [...prev, { role: "user", content: text }]);
      setIsSending(true);

      try {
        const response = await api.chat(text);
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: response.reply },
        ]);
        if (response.boardUpdate) {
          onBoardUpdate?.(response.boardUpdate, response.version);
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          onUnauthorized?.();
          return;
        }
        setError("The AI could not respond. Please try again.");
      } finally {
        setIsSending(false);
      }
    },
    [draft, isSending, onBoardUpdate, onUnauthorized]
  );

  return (
    <aside className="flex h-full flex-col overflow-hidden rounded-3xl border border-[var(--stroke)] bg-[var(--surface-strong)] shadow-[var(--shadow)]">
      <header className="flex items-center gap-3 border-b border-[var(--stroke)] px-5 py-4">
        <div className="h-2.5 w-2.5 rounded-full bg-[var(--accent-yellow)]" />
        <div>
          <h2 className="font-display text-lg font-semibold text-[var(--navy-dark)]">
            AI Assistant
          </h2>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--gray-text)]">
            Ask to update your board
          </p>
        </div>
      </header>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto px-5 py-4"
        data-testid="chat-messages"
      >
        <div className="flex flex-col gap-3">
          {messages.length === 0 && !isSending && (
            <p className="py-6 text-center text-xs font-semibold uppercase tracking-[0.2em] text-[var(--gray-text)]">
              No messages yet. Try asking to add a card to a column.
            </p>
          )}
          {messages.map((message, index) => (
            <ChatBubble key={index} role={message.role} content={message.content} />
          ))}
          {isSending && <ChatBubble role="assistant" content="..." isPending />}
        </div>
      </div>

      {error && (
        <p
          role="alert"
          className="mx-5 mb-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700"
        >
          {error}
        </p>
      )}

      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-2 border-t border-[var(--stroke)] p-3"
      >
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Message the AI..."
          aria-label="Chat message"
          className="w-full rounded-full border border-[var(--stroke)] bg-white px-4 py-2 text-sm text-[var(--navy-dark)] outline-none transition focus:border-[var(--primary-blue)]"
          disabled={isSending}
        />
        <button
          type="submit"
          disabled={isSending || !draft.trim()}
          className="rounded-full bg-[var(--secondary-purple)] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </aside>
  );
};

function ChatBubble({
  role,
  content,
  isPending = false,
}: {
  role: ChatRole;
  content: string;
  isPending?: boolean;
}) {
  const isUser = role === "user";
  return (
    <div className={clsx("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={clsx(
          "max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-6",
          isUser
            ? "bg-[var(--primary-blue)] text-white"
            : "border border-[var(--stroke)] bg-[var(--surface)] text-[var(--navy-dark)]",
          isPending && "opacity-70"
        )}
      >
        {content}
      </div>
    </div>
  );
}

