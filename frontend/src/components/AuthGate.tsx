"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type CurrentUser } from "@/lib/api";
import { LoginForm } from "@/components/LoginForm";
import { KanbanBoard } from "@/components/KanbanBoard";

type AuthStatus = "loading" | "anonymous" | "authenticated";

export const AuthGate = () => {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<CurrentUser | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .me()
      .then((current) => {
        if (!cancelled) {
          setUser(current);
          setStatus("authenticated");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUser(null);
          setStatus("anonymous");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleLogin = useCallback(
    async (username: string, password: string) => {
      const current = await api.login(username, password);
      setUser(current);
      setStatus("authenticated");
    },
    []
  );

  const handleLogout = useCallback(async () => {
    await api.logout();
    setUser(null);
    setStatus("anonymous");
  }, []);

  const handleUnauthorized = useCallback(() => {
    setUser(null);
    setStatus("anonymous");
  }, []);

  if (status === "loading") {
    return (
      <div className="grid min-h-screen place-items-center">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[var(--gray-text)]">
          Loading...
        </p>
      </div>
    );
  }

  if (status === "anonymous") {
    return <LoginForm onLogin={handleLogin} />;
  }

  return (
    <KanbanBoard
      username={user?.username}
      onLogout={handleLogout}
      onUnauthorized={handleUnauthorized}
    />
  );
};
