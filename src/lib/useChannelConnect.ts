"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  getTelegramWebApp,
  isRequestChatSupported,
  isRunningInsideTelegram,
  openTelegramBotLink,
  requestChatSelectionDetailed,
} from "@/lib/telegramWebApp";

export interface ConnectedChannel {
  id: number;
  channelName: string | null;
  channelUsername: string | null;
  status: "pending" | "verified" | "failed" | "disconnected";
  telegramChannelId: string | null;
}

/** Server-reported progress of a pending request (see /api/channels/connect-status). */
export type ConnectStage = "awaiting_selection" | "verifying";

export type BotConnectState =
  | { phase: "idle" }
  // Direct Picker: preparing the request with our backend.
  | { phase: "starting" }
  // Direct Picker: Telegram's native picker is open / selection in progress.
  | { phase: "waiting"; token: string; stage?: ConnectStage }
  // Direct Picker unavailable on this Telegram client → "Connect channel via bot" is offered.
  | { phase: "bot_fallback" }
  // Bot fallback: creating the request and opening the bot chat.
  | { phase: "opening_bot" }
  // Bot fallback: the bot chat was opened; waiting for the user to pick a channel there.
  | { phase: "waiting_bot"; token: string; botUrl: string; stage?: ConnectStage }
  | { phase: "verified"; channel: ConnectedChannel }
  | { phase: "failed"; message: string; reason?: string };

const POLL_INTERVAL_MS = 2500;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;
// The bot fallback involves leaving the Mini App for the bot chat, so it gets
// the server's full pending-request lifetime (10 min) before the client gives up.
const BOT_POLL_TIMEOUT_MS = 10 * 60 * 1000;

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
  /** Present only for the bot-chat fallback, so a reopened Mini App can show the right UI. */
  method?: "bot";
  botUrl?: string;
}

// localStorage survives the Mini App webview being closed when Telegram opens
// the bot chat (older clients close it); sessionStorage is kept as a fallback
// for environments where localStorage is unavailable.
function storages(): Storage[] {
  if (typeof window === "undefined") return [];
  const list: Storage[] = [];
  try {
    list.push(window.localStorage);
  } catch {}
  try {
    list.push(window.sessionStorage);
  } catch {}
  return list;
}

function readPersisted(): PersistedRequest | null {
  for (const store of storages()) {
    try {
      const raw = store.getItem(STORAGE_KEY);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as PersistedRequest;
      if (!parsed || typeof parsed.token !== "string" || typeof parsed.deadline !== "number") continue;
      if (Date.now() > parsed.deadline) {
        persist(null);
        return null;
      }
      return parsed;
    } catch {
      continue;
    }
  }
  return null;
}

function persist(req: PersistedRequest | null) {
  for (const store of storages()) {
    try {
      if (!req) store.removeItem(STORAGE_KEY);
      else store.setItem(STORAGE_KEY, JSON.stringify(req));
    } catch {}
  }
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
 * Shared engine for both channel connection methods:
 *
 * A) Direct Picker (Telegram clients with Bot API 9.6+ `requestChat`):
 *   1. Ask our backend to prepare a `request_chat` keyboard button scoped to
 *      the signed-in Telegram user (`savePreparedKeyboardButton`).
 *   2. Call `Telegram.WebApp.requestChat(id)` directly — Telegram's own
 *      "Select a chat" screen opens immediately, filtered to private
 *      channels, followed by its own "Add bot as administrator" screen if
 *      needed. Neither screen is rendered by Onfile.
 *   3. Poll the backend for the independently verified result once
 *      Telegram's webhook delivers the resulting `chat_shared` update.
 *
 * B) Bot chat fallback ("Connect channel via bot") for clients where the
 *    Direct Picker is genuinely unavailable:
 *   1. Ask our backend for a signed deep link to the configured bot.
 *   2. Open the bot chat; the bot replies with a `request_chat` keyboard.
 *   3. Poll the same status endpoint; the user returns to the Mini App.
 *
 * Capability detection: feature-detect `requestChat` + `isVersionAtLeast`
 * up front (no network call, no tap wasted), and ALSO handle the runtime
 * `WebAppMethodUnsupported` error from `requestChat`. Only those two signals
 * route to the bot fallback — a cancelled picker, a network error or a
 * server error never does.
 *
 * Used both by the dedicated Channel Connect onboarding screens and by
 * Channel Management ("connect another channel") so this logic is defined
 * exactly once.
 */
export function useChannelConnect(onConnected?: (channel: ConnectedChannel) => void) {
  const [state, setState] = useState<BotConnectState>({ phase: "idle" });
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollDeadline = useRef<number>(0);
  const returnListenerCleanup = useRef<(() => void) | null>(null);
  const onConnectedRef = useRef(onConnected);
  onConnectedRef.current = onConnected;

  const stopPolling = useCallback(() => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
    returnListenerCleanup.current?.();
    returnListenerCleanup.current = null;
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  /** Where "Try again"/reset lands: the bot option on clients without the Direct Picker, otherwise idle. */
  const restingState = useCallback((): BotConnectState => {
    return isRunningInsideTelegram() && !isRequestChatSupported() ? { phase: "bot_fallback" } : { phase: "idle" };
  }, []);

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
        } else if (data.status === "pending" && (data.stage === "verifying" || data.stage === "awaiting_selection")) {
          const stage: ConnectStage = data.stage;
          setState((prev) =>
            (prev.phase === "waiting" || prev.phase === "waiting_bot") && prev.stage !== stage ? { ...prev, stage } : prev
          );
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

      // Refresh immediately when the user comes back to the Mini App (e.g.
      // from the bot chat). Telegram does not necessarily reopen/reload it,
      // and timers are throttled while it is in the background.
      const onReturn = () => {
        if (document.visibilityState === "visible") pollOnce(token);
      };
      document.addEventListener("visibilitychange", onReturn);
      window.addEventListener("focus", onReturn);
      const webApp = getTelegramWebApp();
      try {
        // Bot API 8.0+: fired when the Mini App is brought back to the foreground.
        webApp?.onEvent?.("activated", onReturn);
      } catch {}
      const cleanup = () => {
        document.removeEventListener("visibilitychange", onReturn);
        window.removeEventListener("focus", onReturn);
        try {
          webApp?.offEvent?.("activated", onReturn);
        } catch {}
      };
      returnListenerCleanup.current = cleanup;
      return cleanup;
    },
    [pollOnce, stopPolling]
  );

  // On mount: resume a pending request if the Mini App / tab was reopened
  // while Telegram's native selection (or the bot chat) was in progress;
  // otherwise, on Telegram clients without the Direct Picker, go straight to
  // offering the bot fallback instead of a dead-end "update Telegram" notice.
  useEffect(() => {
    const pending = readPersisted();
    if (pending) {
      if (pending.method === "bot" && pending.botUrl) {
        setState({ phase: "waiting_bot", token: pending.token, botUrl: pending.botUrl });
      } else {
        setState({ phase: "waiting", token: pending.token });
      }
      return startPolling(pending.token, pending.deadline);
    }
    if (isRunningInsideTelegram() && !isRequestChatSupported()) {
      setState({ phase: "bot_fallback" });
    }
    // Only ever run once on mount — subsequent starts are driven by `start()`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Direct Picker. */
  const start = useCallback(async () => {
    // Feature detection up front, before any network call. An unsupported
    // client is offered the bot fallback — never a forced-update message.
    if (!isRequestChatSupported()) {
      setState({ phase: "bot_fallback" });
      return;
    }

    setState({ phase: "starting" });
    try {
      const res = await fetch("/api/channels/connect-request", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.token || !data.preparedButtonId) {
        // Server / network / auth problem: NOT a capability problem, so no fallback.
        setState({ phase: "failed", message: data.error || "Could not start the connection flow.", reason: data.reason });
        return;
      }

      const deadline = Date.now() + POLL_TIMEOUT_MS;
      persist({ token: data.token, deadline });
      setState({ phase: "waiting", token: data.token });
      startPolling(data.token, deadline);

      // Opens Telegram's native chat-selection dialog directly — no bot
      // chat, no intermediate screen. "sent" reflects whether Telegram
      // delivered the resulting chat_shared update to the bot at all; the
      // actual private/admin verification happens independently once the
      // webhook (and this poll) observes the outcome.
      const outcome = await requestChatSelectionDetailed(data.preparedButtonId);
      if (outcome === "sent") return;

      stopPolling();
      persist(null);
      notifyCancelled(data.token);
      if (outcome === "unsupported") {
        // Runtime capability signal (WebAppMethodUnsupported): the client
        // genuinely cannot open the Direct Picker → offer the bot fallback.
        setState({ phase: "bot_fallback" });
      } else if (outcome === "not_sent") {
        setState({ phase: "failed", message: "Channel selection was cancelled. Please try again.", reason: "cancelled" });
      } else {
        setState({ phase: "failed", message: "Telegram couldn't open the channel picker. Please try again.", reason: "picker_error" });
      }
    } catch {
      setState({ phase: "failed", message: "Network error. Please try again." });
    }
  }, [startPolling, stopPolling]);

  /** Bot chat fallback: "Connect channel via bot". */
  const startViaBot = useCallback(async () => {
    setState({ phase: "opening_bot" });
    try {
      const res = await fetch("/api/channels/connect-bot-request", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.token || !data.botUrl) {
        setState({ phase: "failed", message: data.error || "Could not open the Onfile Bot. Please try again.", reason: data.reason });
        return;
      }

      const deadline = Date.now() + BOT_POLL_TIMEOUT_MS;
      persist({ token: data.token, deadline, method: "bot", botUrl: data.botUrl });
      setState({ phase: "waiting_bot", token: data.token, botUrl: data.botUrl });
      startPolling(data.token, deadline);
      // Opens the real Onfile Bot chat. The native channel picker only opens
      // once the user taps the keyboard button the bot sends there.
      openTelegramBotLink(data.botUrl);
    } catch {
      setState({ phase: "failed", message: "Network error. Please try again." });
    }
  }, [startPolling]);

  /** Re-opens the same bot chat for the same pending request (no new request). */
  const reopenBot = useCallback((botUrl: string) => {
    openTelegramBotLink(botUrl);
  }, []);

  /** Manual "I'm back" refresh for the waiting states. */
  const refresh = useCallback(() => {
    const pending = readPersisted();
    if (pending) pollOnce(pending.token);
  }, [pollOnce]);

  const reset = useCallback(() => {
    // Abandon a still-pending request on the server too, rather than leaving
    // it claimable by a late bot interaction.
    const pending = readPersisted();
    if (pending) notifyCancelled(pending.token);
    stopPolling();
    persist(null);
    setState(restingState());
  }, [stopPolling, restingState]);

  return { state, start, startViaBot, reopenBot, refresh, reset };
}
