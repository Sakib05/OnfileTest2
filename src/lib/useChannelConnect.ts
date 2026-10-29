"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { openBotChat } from "@/lib/telegramWebApp";

export interface ConnectedChannel {
  id: number;
  channelName: string | null;
  channelUsername: string | null;
  status: "pending" | "verified" | "failed" | "disconnected";
  telegramChannelId: string | null;
}

export type BotConnectState =
  | { phase: "idle" }
  | { phase: "starting" }
  | { phase: "waiting"; botUsername: string; token: string }
  | { phase: "needs_bot_chat"; botUsername: string }
  | { phase: "verified"; channel: ConnectedChannel }
  | { phase: "failed"; message: string };

const POLL_INTERVAL_MS = 2500;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

// Persists the in-flight request's correlation token (never any secret —
// it's an opaque, unguessable bearer handed back by our own backend) so
// that reopening the Mini App / browser tab while Telegram's native chat
// picker is still open can resume polling instead of losing the request
// and forcing the user to start over. This is purely a client-side UX
// convenience: the backend independently expires/validates the token
// regardless of what the client remembers.
const STORAGE_KEY = "onfile_pending_channel_connect";

interface PersistedRequest {
  token: string;
  botUsername: string;
  deadline: number;
}

function readPersisted(): PersistedRequest | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedRequest;
    if (!parsed || typeof parsed.token !== "string" || typeof parsed.deadline !== "number") return null;
    if (Date.now() > parsed.deadline) {
      window.sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function persist(req: PersistedRequest | null) {
  if (typeof window === "undefined") return;
  if (!req) {
    window.sessionStorage.removeItem(STORAGE_KEY);
    return;
  }
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(req));
}

/**
 * Shared engine for the native Telegram "select chat, then add bot as
 * admin" channel connection flow. Used both by the dedicated Channel
 * Connect onboarding screens and by Channel Management ("connect another
 * channel") so the business logic (and its reliability characteristics)
 * is defined exactly once.
 */
export function useChannelConnect(onConnected?: (channel: ConnectedChannel) => void) {
  const [state, setState] = useState<BotConnectState>({ phase: "idle" });
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollDeadline = useRef<number>(0);
  const onConnectedRef = useRef(onConnected);
  onConnectedRef.current = onConnected;

  const stopPolling = useCallback(() => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  const pollOnce = useCallback(
    async (token: string) => {
      try {
        const res = await fetch(`/api/channels/connect-status?token=${encodeURIComponent(token)}`);
        const data = await res.json().catch(() => ({}));
        if (data.status === "verified") {
          stopPolling();
          persist(null);
          setState({ phase: "verified", channel: data.channel });
          onConnectedRef.current?.(data.channel);
        } else if (data.status === "failed") {
          stopPolling();
          persist(null);
          setState({ phase: "failed", message: data.error || "Channel verification failed." });
        } else if (data.status === "expired") {
          stopPolling();
          persist(null);
          setState({ phase: "failed", message: "This connection request expired. Please try again." });
        } else if (Date.now() > pollDeadline.current) {
          stopPolling();
          persist(null);
          setState({ phase: "failed", message: "We didn't detect a channel selection in time. Please try again." });
        }
      } catch {
        if (Date.now() > pollDeadline.current) {
          stopPolling();
          persist(null);
          setState({ phase: "failed", message: "Network error while checking connection status." });
        }
      }
    },
    [stopPolling]
  );

  const startPolling = useCallback(
    (token: string, deadline: number) => {
      pollDeadline.current = deadline;
      stopPolling();
      pollOnce(token);
      pollTimer.current = setInterval(() => pollOnce(token), POLL_INTERVAL_MS);
      const onVisible = () => {
        if (document.visibilityState === "visible") pollOnce(token);
      };
      document.addEventListener("visibilitychange", onVisible);
      return () => document.removeEventListener("visibilitychange", onVisible);
    },
    [pollOnce, stopPolling]
  );

  // Resume a pending request if the Mini App / tab was reopened while
  // Telegram's native selection screens were still in progress.
  useEffect(() => {
    const pending = readPersisted();
    if (!pending) return;
    setState({ phase: "waiting", botUsername: pending.botUsername, token: pending.token });
    const cleanup = startPolling(pending.token, pending.deadline);
    return cleanup;
    // Only ever run once on mount — subsequent starts are driven by `start()`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = useCallback(async () => {
    setState({ phase: "starting" });
    try {
      const res = await fetch("/api/channels/connect-request", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.reason === "cannot_message_user" && data.botUsername) {
          setState({ phase: "needs_bot_chat", botUsername: data.botUsername });
          return;
        }
        setState({ phase: "failed", message: data.error || "Could not start the connection flow." });
        return;
      }
      const deadline = Date.now() + POLL_TIMEOUT_MS;
      persist({ token: data.token, botUsername: data.botUsername, deadline });
      setState({ phase: "waiting", botUsername: data.botUsername, token: data.token });
      startPolling(data.token, deadline);
      openBotChat(data.botUsername);
    } catch {
      setState({ phase: "failed", message: "Network error. Please try again." });
    }
  }, [startPolling]);

  const reopenBotChat = useCallback((botUsername: string) => {
    openBotChat(botUsername);
  }, []);

  const reset = useCallback(() => {
    stopPolling();
    persist(null);
    setState({ phase: "idle" });
  }, [stopPolling]);

  return { state, start, reopenBotChat, reset };
}
