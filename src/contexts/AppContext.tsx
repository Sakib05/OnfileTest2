"use client";
import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { getTelegramInitData } from "@/lib/telegramWebApp";

export interface UserProfile {
  id: number;
  telegramId?: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  avatarUrl?: string;
  balance: string;
  pendingBalance: string;
  referralEarnings: string;
  totalDownloads: number;
  totalEarnings: string;
  referralCode?: string;
  darkMode?: boolean;
  language?: string;
}

export interface SetupProfile {
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  avatarUrl: string | null;
}

/**
 * - "loading": we haven't checked for a session yet.
 * - "guest": no session; visitor has not started Telegram login.
 * - "setup_required": Telegram identity verified, but no channel is
 *   connected yet / no permanent account exists.
 * - "authenticated": a real creator session is active.
 */
export type AuthStatus = "loading" | "guest" | "setup_required" | "authenticated";

interface AppContextValue {
  user: UserProfile | null;
  authStatus: AuthStatus;
  setupProfile: SetupProfile | null;
  activeTab: string;
  setActiveTab: (t: string) => void;
  refreshUser: () => Promise<void>;
  startTelegramLogin: () => Promise<{ ok: boolean; error?: string }>;
  logout: () => Promise<void>;
}

const AppContext = createContext<AppContextValue>({
  user: null,
  authStatus: "loading",
  setupProfile: null,
  activeTab: "home",
  setActiveTab: () => {},
  refreshUser: async () => {},
  startTelegramLogin: async () => ({ ok: false }),
  logout: async () => {},
});

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthStatus>("loading");
  const [setupProfile, setSetupProfile] = useState<SetupProfile | null>(null);
  const [activeTab, setActiveTab] = useState("home");

  const refreshUser = useCallback(async () => {
    try {
      const res = await fetch("/api/user/me");
      if (res.ok) {
        const data = await res.json();
        if (data.user) {
          setUser(data.user);
          setAuthStatus("authenticated");
          return;
        }
      }
      setUser(null);
      setAuthStatus((prev) => (prev === "setup_required" ? "setup_required" : "guest"));
    } catch {
      setUser(null);
      setAuthStatus("guest");
    }
  }, []);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  /**
   * Exchanges the Telegram Mini App's signed `initData` for either a real
   * session (returning creator) or a short-lived setup state (new
   * Telegram identity that still needs to connect/verify a channel).
   */
  const startTelegramLogin = useCallback(async () => {
    const initData = getTelegramInitData();
    if (!initData) {
      return { ok: false, error: "Open Onfile from within Telegram to continue." };
    }
    try {
      const res = await fetch("/api/auth/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { ok: false, error: data.error || "Telegram sign-in failed." };
      }
      if (data.status === "authenticated") {
        await refreshUser();
        return { ok: true };
      }
      if (data.status === "setup_required") {
        setSetupProfile(data.profile ?? null);
        setAuthStatus("setup_required");
        return { ok: true };
      }
      return { ok: false, error: "Unexpected response from server." };
    } catch {
      return { ok: false, error: "Network error. Please try again." };
    }
  }, [refreshUser]);

  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // ignore network errors on logout; still clear local state below
    }
    setUser(null);
    setSetupProfile(null);
    setAuthStatus("guest");
  }, []);

  return (
    <AppContext.Provider
      value={{ user, authStatus, setupProfile, activeTab, setActiveTab, refreshUser, startTelegramLogin, logout }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  return useContext(AppContext);
}
