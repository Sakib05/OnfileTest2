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

/**
 * Whether the authenticated creator currently has at least one verified
 * Telegram channel connected. `"unknown"` means we haven't checked yet (or
 * the check is in flight) and the UI should treat it like a loading state
 * rather than guessing either way.
 */
export type ChannelStatus = "unknown" | "has_channel" | "no_channel";

interface AppContextValue {
  user: UserProfile | null;
  authStatus: AuthStatus;
  setupProfile: SetupProfile | null;
  channelStatus: ChannelStatus;
  activeTab: string;
  setActiveTab: (t: string) => void;
  refreshUser: () => Promise<void>;
  refreshChannels: () => Promise<void>;
  startTelegramLogin: () => Promise<{ ok: boolean; error?: string }>;
  logout: () => Promise<void>;
}

const AppContext = createContext<AppContextValue>({
  user: null,
  authStatus: "loading",
  setupProfile: null,
  channelStatus: "unknown",
  activeTab: "home",
  setActiveTab: () => {},
  refreshUser: async () => {},
  refreshChannels: async () => {},
  startTelegramLogin: async () => ({ ok: false }),
  logout: async () => {},
});

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthStatus>("loading");
  const [setupProfile, setSetupProfile] = useState<SetupProfile | null>(null);
  const [channelStatus, setChannelStatus] = useState<ChannelStatus>("unknown");
  const [activeTab, setActiveTab] = useState("home");

  /**
   * Checks whether the authenticated creator has at least one verified
   * channel. Always derived from the backend's live `channels` rows — never
   * from anything cached client-side — so a disconnected/never-connected
   * creator is correctly routed back to the Channel Connect screen.
   */
  const refreshChannels = useCallback(async () => {
    try {
      const res = await fetch("/api/channels");
      if (!res.ok) {
        setChannelStatus("unknown");
        return;
      }
      const data = await res.json();
      const hasVerified = Array.isArray(data.channels) && data.channels.some((c: { status?: string }) => c.status === "verified");
      setChannelStatus(hasVerified ? "has_channel" : "no_channel");
    } catch {
      setChannelStatus("unknown");
    }
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const res = await fetch("/api/user/me");
      if (res.ok) {
        const data = await res.json();
        if (data.user) {
          setUser(data.user);
          setAuthStatus("authenticated");
          await refreshChannels();
          return;
        }
      }
      setUser(null);
      setChannelStatus("unknown");
      setAuthStatus((prev) => (prev === "setup_required" ? "setup_required" : "guest"));
    } catch {
      setUser(null);
      setChannelStatus("unknown");
      setAuthStatus("guest");
    }
  }, [refreshChannels]);

  useEffect(() => {
    // One-time session check on mount; must run client-side against the
    // HttpOnly session cookie, which cannot be read during render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
    setChannelStatus("unknown");
    setAuthStatus("guest");
  }, []);

  return (
    <AppContext.Provider
      value={{
        user,
        authStatus,
        setupProfile,
        channelStatus,
        activeTab,
        setActiveTab,
        refreshUser,
        refreshChannels,
        startTelegramLogin,
        logout,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  return useContext(AppContext);
}
