import type { BoardData } from "@/lib/kanban";

export type CurrentUser = { username: string };
export type BoardResponse = { title: string; data: BoardData; version: number };

export type ChatRole = "user" | "assistant";
export type ChatMessage = { role: ChatRole; content: string };
export type ChatResponse = {
  reply: string;
  boardUpdate: BoardData | null;
  version: number;
};
export type ChatHistoryResponse = { messages: ChatMessage[] };

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    ...init,
  });

  if (!response.ok) {
    throw new ApiError(response.status, await readError(response));
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown };
    return typeof body.detail === "string" ? body.detail : response.statusText;
  } catch {
    return response.statusText;
  }
}

export const api = {
  me: () => request<CurrentUser>("/api/auth/me"),
  login: (username: string, password: string) =>
    request<CurrentUser>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  logout: () => request<{ status: string }>("/api/auth/logout", { method: "POST" }),
  getBoard: () => request<BoardResponse>("/api/kanban"),
  saveBoard: (data: BoardData, version: number) =>
    request<BoardResponse>("/api/kanban", {
      method: "POST",
      body: JSON.stringify({ data, version }),
    }),
  chat: (message: string) =>
    request<ChatResponse>("/api/chat", {
      method: "POST",
      body: JSON.stringify({ message }),
    }),
  getChatHistory: () => request<ChatHistoryResponse>("/api/chat/history"),
};
