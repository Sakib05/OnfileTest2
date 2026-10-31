"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { isRequestChatSupported, requestChatSelection } from "@/lib/telegramWebApp";

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
  | { phase: "waiting"; token: string }
  | { phase: "unsupported" }
  | { phase: "verified"; channel: ConnectedChannel }
  | { phase: "failed"; message: string; reason?: string };

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

/** Fire-and-forget: tells the backend to stop waiting on a token the client
 * already knows will never resolve (picker cancelled / selection not sent).
 * Never blocks the UI on the outcome of this call. */
function notifyCancelled(token: string) {
  fetch("/api/channels/connect-cancel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
    keepalive: true,
  }).catch(() => {});
}

/**
 * Shared engine for the native Telegram direct channel-picker connection
 * flow:
 *   1. Ask our backend to prepare a `request_chat` keyboard button scoped to
 *      the signed-in Telegram user (`savePreparedKeyboardButton`).
 *   2. Call `Telegram.WebApp.requestChat(id)` directly — Telegram's own
 *      "Select a chat" screen opens immediately, filtered to private
 *      channels, followed by its own "Add bot as administrator" screen if
 *      needed. Neither screen is rendered by Onfile.
 *   3. Poll the backend for the independently verified result once
 *      Telegram's webhook delivers the resulting `chat_shared` update.
 * Used both by the dedicated Channel Connect onboarding screens and by
 * Channel Management ("connect another channel") so this logic (and its
 * reliability characteristics) is defined exactly once.
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
          setState({ phase: "failed", message: data.error || "Channel verification failed.", reason: data.reason });
        } else if (data.status === "expired") {
          stopPolling();
          persist(null);
          setState({ phase: "failed", message: "This connection request expired. Please try again.", reason: "expired" });
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
    setState({ phase: "waiting", token: pending.token });
    const cleanup = startPolling(pending.token, pending.deadline);
    return cleanup;
    // Only ever run once on mount — subsequent starts are driven by `start()`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = useCallback(async () => {
    // Checked up front, before any network call: an unsupported Telegram
    // client never falls back to the old bot-chat flow — it is shown an
    // explicit "please update Telegram" state instead (Part A.6).
    if (!isRequestChatSupported()) {
      setState({ phase: "unsupported" });
      return;
    }

    setState({ phase: "starting" });
    try {
      const res = await fetch("/api/channels/connect-request", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.token || !data.preparedButtonId) {
        setState({ phase: "failed", message: data.error || "Could not start the connection flow.", reason: data.reason });
        return;
      }

      const deadline = Date.now() + POLL_TIMEOUT_MS;
      persist({ token: data.token, deadline });
      setState({ phase: "waiting", token: data.token });
      startPolling(data.token, deadline);

      // Opens Telegram's native chat-selection dialog directly — no bot
      // chat, no intermediate screen. `sent` reflects whether Telegram
      // delivered the resulting chat_shared update to the bot at all; the
      // actual private/admin verification happens independently once the
      // webhook (and this poll) observes the outcome.
      const sent = await requestChatSelection(data.preparedButtonId);
      if (!sent) {
        stopPolling();
        persist(null);
        notifyCancelled(data.token);
        setState({ phase: "failed", message: "Channel selection was cancelled. Please try again.", reason: "cancelled" });
      }
    } catch {
      setState({ phase: "failed", message: "Network error. Please try again." });
    }
  }, [startPolling, stopPolling]);

  const reset = useCallback(() => {
    stopPolling();
    persist(null);
    setState({ phase: "idle" });
  }, [stopPolling]);

  return { state, start, reset };
}
