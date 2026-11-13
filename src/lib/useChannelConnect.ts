"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  getTelegramWebApp,
  isRequestChatSupported,
  isRunningInsideTelegram,
  openTelegramBotLink,
  requestChatSelectionDetailed,
  triggerHaptic,
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

/** How the bot chat was reached (see /api/channels/connect-bot-request). */
export type BotConnectMode = "existing_chat" | "start_link";

/** Result of the manual "check status" action, shown under the waiting screen. */
export interface StatusCheckState {
  loading: boolean;
  message: string | null;
  tone: "info" | "error";
}
const IDLE_CHECK: StatusCheckState = { loading: false, message: null, tone: "info" };

type StatusOutcome =
  | { kind: "verified"; channel: ConnectedChannel }
  | { kind: "pending"; stage?: ConnectStage }
  | { kind: "failed"; message: string; reason?: string }
  | { kind: "expired" }
  | { kind: "unauthorized"; message: string }
  | { kind: "error" };

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
  //   mode "existing_chat": the keyboard was sent into the user's existing chat (plain chat link, no /start).
  //   mode "start_link":    first-time / blocked user — the signed ?start= deep link was used.
  //   openFailed: Telegram refused to open the chat automatically (shown as plain text, never silently).
  | {
      phase: "waiting_bot";
      token: string;
      botUrl: string;
      mode: BotConnectMode;
      botUsername?: string;
      stage?: ConnectStage;
      openFailed?: boolean;
    }
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
  mode?: BotConnectMode;
  botUsername?: string;
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

/** Maps a /api/channels/connect-status HTTP response onto a typed outcome. */
function interpretStatusResponse(res: Response, data: Record<string, unknown> | null): StatusOutcome {
  const status = data?.status;
  if (status === "verified" && res.ok && data?.channel) return { kind: "verified", channel: data.channel as ConnectedChannel };
  if (status === "pending") {
    const stage = data?.stage === "verifying" || data?.stage === "awaiting_selection" ? (data.stage as ConnectStage) : undefined;
    return { kind: "pending", stage };
  }
  if (status === "failed") {
    return {
      kind: "failed",
      message: typeof data?.error === "string" && data.error ? data.error : "Channel verification failed.",
      reason: typeof data?.reason === "string" ? data.reason : undefined,
    };
  }
  if (status === "expired") return { kind: "expired" };
  if (status === "unauthorized") {
    return {
      kind: "unauthorized",
      message: typeof data?.error === "string" && data.error ? data.error : "Your Telegram session expired. Please reopen Onfile and try again.",
    };
  }
  // Non-JSON body, 5xx, or any shape we don't recognise: a server/network problem, NOT a verdict.
  return { kind: "error" };
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
 *    Direct Picker is genuinely unavailable — ONE tap does everything:
 *   1. Ask our backend to prepare the request. Returning users (a verified
 *      private chat is on file): the backend sends the `request_chat` keyboard
 *      into that chat and we receive the PLAIN bot link (no `?start=`, so no
 *      new "/start"). First-time / blocked users: we receive the signed start link.
 *   2. Subtle haptic, then open the bot chat automatically with
 *      `Telegram.WebApp.openTelegramLink` (a refusal is surfaced, not hidden).
 *   3. Poll the same status endpoint; the user returns to the Mini App.
 *
 * Status checking (automatic polling AND the manual "check status" action)
 * goes through ONE de-duplicated function: concurrent checks share a single
 * request, responses for a superseded request are ignored, and a terminal
 * outcome (connected / failed / expired) is applied exactly once — so the
 * success haptic, the success state and `onConnected` can never fire twice.
 * Success is only ever reported after the server says "verified".
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
  const [check, setCheck] = useState<StatusCheckState>(IDLE_CHECK);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollDeadline = useRef<number>(0);
  const returnListenerCleanup = useRef<(() => void) | null>(null);
  const onConnectedRef = useRef(onConnected);
  onConnectedRef.current = onConnected;

  /** The request currently being tracked; responses for any other token are stale. */
  const activeToken = useRef<string | null>(null);
  /** Single in-flight status request (shared by the poll timer and the manual check). */
  const inFlight = useRef<{ token: string; promise: Promise<StatusOutcome> } | null>(null);
  /** Tokens whose terminal outcome was already applied (no duplicate success/haptic/callback). */
  const finished = useRef<Set<string>>(new Set());
  const botStarting = useRef(false);
  const manualChecking = useRef(false);
  const mounted = useRef(true);

  const stopPolling = useCallback(() => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
    returnListenerCleanup.current?.();
    returnListenerCleanup.current = null;
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stopPolling();
    };
  }, [stopPolling]);

  /** Where "Try again"/reset lands: the bot option on clients without the Direct Picker, otherwise idle. */
  const restingState = useCallback((): BotConnectState => {
    return isRunningInsideTelegram() && !isRequestChatSupported() ? { phase: "bot_fallback" } : { phase: "idle" };
  }, []);

  /** Ends tracking of `token` with a terminal failure (applied once). */
  const finishFailed = useCallback(
    (token: string, message: string, reason?: string) => {
      finished.current.add(token);
      activeToken.current = null;
      stopPolling();
      persist(null);
      triggerHaptic("error");
      setState({ phase: "failed", message, reason });
    },
    [stopPolling]
  );

  /**
   * Fetches the request's status once and applies it. Concurrent callers for
   * the same token share the same request. Never throws.
   */
  const checkStatus = useCallback(
    (token: string): Promise<StatusOutcome> => {
      if (inFlight.current && inFlight.current.token === token) return inFlight.current.promise;

      const promise = (async (): Promise<StatusOutcome> => {
        let outcome: StatusOutcome;
        try {
          const res = await fetch(`/api/channels/connect-status?token=${encodeURIComponent(token)}`);
          const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
          outcome = interpretStatusResponse(res, data);
        } catch {
          outcome = { kind: "error" };
        }

        // Stale (request superseded / reset / unmounted) or already concluded: report, don't apply.
        if (!mounted.current || activeToken.current !== token || finished.current.has(token)) return outcome;

        switch (outcome.kind) {
          case "verified":
            finished.current.add(token);
            activeToken.current = null;
            stopPolling();
            persist(null);
            // Success haptic ONLY after the server confirmed the connection.
            triggerHaptic("success");
            setState({ phase: "verified", channel: outcome.channel });
            onConnectedRef.current?.(outcome.channel);
            break;
          case "failed":
            finishFailed(token, outcome.message, outcome.reason);
            break;
          case "expired":
            finishFailed(token, "This connection request expired. Please try again.", "expired");
            break;
          case "unauthorized":
            finishFailed(token, outcome.message, "unauthorized");
            break;
          case "pending":
            if (Date.now() > pollDeadline.current) {
              finishFailed(token, "We didn't detect a channel selection in time. Please try again.", "timeout");
            } else if (outcome.stage) {
              const stage = outcome.stage;
              setState((prev) =>
                (prev.phase === "waiting" || prev.phase === "waiting_bot") && prev.stage !== stage ? { ...prev, stage } : prev
              );
            }
            break;
          case "error":
            if (Date.now() > pollDeadline.current) {
              finishFailed(token, "Network error while checking connection status.", "network");
            }
            break;
        }
        return outcome;
      })().finally(() => {
        if (inFlight.current?.token === token) inFlight.current = null;
      });

      inFlight.current = { token, promise };
      return promise;
    },
    [stopPolling, finishFailed]
  );

  const startPolling = useCallback(
    (token: string, deadline: number) => {
      pollDeadline.current = deadline;
      activeToken.current = token;
      stopPolling();
      void checkStatus(token);
      pollTimer.current = setInterval(() => void checkStatus(token), POLL_INTERVAL_MS);

      // Refresh immediately when the user comes back to the Mini App (e.g.
      // from the bot chat). Telegram does not necessarily reopen/reload it,
      // and timers are throttled while it is in the background.
      const onReturn = () => {
        if (document.visibilityState === "visible") void checkStatus(token);
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
    [checkStatus, stopPolling]
  );

  // On mount: resume a pending request if the Mini App / tab was reopened
  // while Telegram's native selection (or the bot chat) was in progress;
  // otherwise, on Telegram clients without the Direct Picker, go straight to
  // offering the bot fallback instead of a dead-end "update Telegram" notice.
  useEffect(() => {
    const pending = readPersisted();
    if (pending) {
      if (pending.method === "bot" && pending.botUrl) {
        setState({
          phase: "waiting_bot",
          token: pending.token,
          botUrl: pending.botUrl,
          mode: pending.mode ?? "start_link",
          botUsername: pending.botUsername,
        });
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

      // The picker never completed. If the poll already concluded this request
      // (verified/failed) don't overwrite that result.
      if (finished.current.has(data.token)) return;
      stopPolling();
      activeToken.current = null;
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

  /**
   * Bot chat fallback: "Connect channel via bot" — the ONLY connect action.
   * prepare request → (server sends keyboard / prepares signed start link)
   * → haptic → open the bot chat automatically.
   */
  const startViaBot = useCallback(async () => {
    if (botStarting.current) return; // ignore double taps: never two requests / two chats
    botStarting.current = true;
    setCheck(IDLE_CHECK);
    setState({ phase: "opening_bot" });
    try {
      let res: Response;
      let data: Record<string, unknown>;
      try {
        res = await fetch("/api/channels/connect-bot-request", { method: "POST" });
        data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      } catch {
        triggerHaptic("error");
        setState({ phase: "failed", message: "Network error. Please try again." });
        return;
      }
      if (!mounted.current) return;
      if (!res.ok || typeof data.token !== "string" || typeof data.botUrl !== "string") {
        triggerHaptic("error");
        setState({
          phase: "failed",
          message: (typeof data.error === "string" && data.error) || "Could not open the Onfile Bot. Please try again.",
          reason: typeof data.reason === "string" ? data.reason : undefined,
        });
        return;
      }

      const token = data.token;
      const botUrl = data.botUrl;
      const mode: BotConnectMode = data.mode === "existing_chat" ? "existing_chat" : "start_link";
      const botUsername = typeof data.botUsername === "string" ? data.botUsername : undefined;

      const deadline = Date.now() + BOT_POLL_TIMEOUT_MS;
      persist({ token, deadline, method: "bot", botUrl, mode, botUsername });
      setState({ phase: "waiting_bot", token, botUrl, mode, botUsername });
      startPolling(token, deadline);

      // The request is prepared (keyboard sent / signed start link ready):
      // subtle haptic, then IMMEDIATELY open the bot chat. Haptics are
      // best-effort and can never block the redirect.
      triggerHaptic("impact");
      const opened = openTelegramBotLink(botUrl);
      if (!opened) {
        // Don't fail silently: tell the user how to reach the bot themselves.
        triggerHaptic("warning");
        setState((prev) => (prev.phase === "waiting_bot" && prev.token === token ? { ...prev, openFailed: true } : prev));
      }
    } finally {
      botStarting.current = false;
    }
  }, [startPolling]);

  /**
   * Manual "I've finished in the bot — check status". Shows loading at once,
   * asks the server (which verifies the request belongs to this Telegram
   * user), and reports pending / expired / error explicitly. Shares the
   * in-flight request with the poll timer, so it can't create duplicates.
   */
  const refresh = useCallback(async () => {
    if (manualChecking.current) return;
    const token = activeToken.current ?? readPersisted()?.token ?? null;
    if (!token) {
      setCheck(IDLE_CHECK);
      setState({
        phase: "failed",
        message: "This connection request is no longer active. Please start again.",
        reason: "expired",
      });
      return;
    }
    manualChecking.current = true;
    setCheck({ loading: true, message: null, tone: "info" });
    try {
      const outcome = await checkStatus(token);
      if (!mounted.current || (activeToken.current !== null && activeToken.current !== token)) return;
      if (outcome.kind === "pending") {
        setCheck({
          loading: false,
          tone: "info",
          message:
            outcome.stage === "verifying"
              ? "Channel selected — verifying with Telegram…"
              : "Not connected yet. Choose your channel in the bot chat, then check again.",
        });
      } else if (outcome.kind === "error") {
        setCheck({
          loading: false,
          tone: "error",
          message: "Couldn't check the status. Please check your connection and try again.",
        });
      } else {
        setCheck(IDLE_CHECK); // terminal outcome: the main state already changed
      }
    } finally {
      manualChecking.current = false;
    }
  }, [checkStatus]);

  const reset = useCallback(() => {
    // Abandon a still-pending request on the server too, rather than leaving
    // it claimable by a late bot interaction.
    const pending = readPersisted();
    if (pending) notifyCancelled(pending.token);
    stopPolling();
    activeToken.current = null;
    persist(null);
    setCheck(IDLE_CHECK);
    setState(restingState());
  }, [stopPolling, restingState]);

  return { state, check, start, startViaBot, refresh, reset };
}
