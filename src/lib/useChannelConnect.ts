"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { getTelegramWebApp, openTelegramBotLink, triggerHaptic } from "@/lib/telegramWebApp";
import { BOT_NAVIGATION_DELAY_MS, clearLaunchConnectRef, getLaunchConnectRef, sleep } from "@/lib/botConnectClient";

export interface ConnectedChannel {
  id: number;
  channelName: string | null;
  channelUsername: string | null;
  status: "pending" | "verified" | "failed" | "disconnected";
  telegramChannelId: string | null;
}

/** Server-reported progress of a pending request (see /api/channels/connect-status). */
export type ConnectStage = "awaiting_selection" | "verifying";

/** How the bot chat is reached (see /api/channels/connect-bot-start). */
export type BotConnectMode = "existing_chat" | "start_link";

/** Status of the automatic verification, shown under the waiting screen. */
export interface StatusCheckState {
  loading: boolean;
  message: string | null;
  tone: "info" | "error";
}
const IDLE_CHECK: StatusCheckState = { loading: false, message: null, tone: "info" };

/** Server clock vs. this device's clock, so the countdown follows the SERVER's expiry. */
export interface ServerClock {
  /** Absolute expiry, ms since epoch (server-authoritative, UTC). */
  expiresAt: number;
  /** serverTime − Date.now() at the moment the server answered (ms). */
  offset: number;
}

type StatusOutcome =
  | { kind: "verified"; channel: ConnectedChannel }
  | { kind: "pending"; stage?: ConnectStage; lifecycle?: string; clock?: ServerClock; ref?: number }
  | { kind: "failed"; message: string; reason?: string }
  | { kind: "expired" }
  | { kind: "unauthorized"; message: string }
  | { kind: "error" };

/**
 * Phases of the bot-guided flow (Start → Connect → bot chat → Return to Onfile):
 *
 *   idle        existing instructions + "Start"
 *   preparing   "Start" tapped, request being created (no bot message, no countdown yet)
 *   prepared    request exists → "Connect"           (server state `prepared`)
 *   connecting  "Connect" tapped: countdown running, ~3 s before the bot chat opens
 *   waiting_bot bot chat opened; waiting for the channel selection / automatic verification
 *   resuming    Mini App reopened (e.g. "Return to Onfile"): reading the server-side status
 *   verified    server confirmed the connection
 *   failed      failure / expiry / cancellation (retry with "Start")
 */
export type BotConnectState =
  | { phase: "idle" }
  | { phase: "preparing" }
  | { phase: "prepared"; token: string; ref: number; botUsername?: string; error?: string }
  | { phase: "connecting"; token: string; ref: number; botUsername?: string; clock: ServerClock }
  | {
      phase: "waiting_bot";
      token: string | null;
      ref: number | null;
      botUrl: string | null;
      mode: BotConnectMode | null;
      botUsername?: string;
      clock: ServerClock | null;
      stage?: ConnectStage;
      /** Telegram refused / threw on openTelegramLink — the user must open the chat themselves. */
      openFailed?: boolean;
      /** The Mini App is still in the foreground a few seconds after navigation was initiated. */
      stillVisible?: boolean;
    }
  | { phase: "resuming" }
  | { phase: "verified"; channel: ConnectedChannel }
  | { phase: "failed"; message: string; reason?: string };

const POLL_INTERVAL_MS = 3000;
/** Grace after the server-side expiry before the client stops polling on its own. */
const POLL_GRACE_MS = 30_000;
/** How long after navigation we wait before suggesting the manual "open the bot" link. */
const FOREGROUND_HINT_MS = 4000;

// Persists the in-flight request's correlation token (an opaque, unguessable bearer
// handed back by our own backend — never a Telegram id or any secret) so the Mini App
// can resume after Telegram minimises/reopens it. Purely a UX convenience: the backend
// independently validates and expires everything, and the "Return to Onfile" link also
// carries the public request ref as a storage-less fallback.
const STORAGE_KEY = "onfile_pending_channel_connect";

interface PersistedRequest {
  token: string;
  ref?: number;
  /** Absolute deadline for local polling (ms). */
  deadline: number;
  botUrl?: string;
  mode?: BotConnectMode;
  botUsername?: string;
}

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

/** Fire-and-forget: tells the backend to stop waiting on a request the user abandoned. */
function notifyCancelled(token: string) {
  fetch("/api/channels/connect-cancel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
    keepalive: true,
  }).catch(() => {});
}

function clockFrom(data: Record<string, unknown> | null): ServerClock | undefined {
  const exp = typeof data?.expiresAt === "string" ? Date.parse(data.expiresAt) : NaN;
  const now = typeof data?.serverTime === "string" ? Date.parse(data.serverTime) : NaN;
  if (Number.isNaN(exp)) return undefined;
  return { expiresAt: exp, offset: Number.isNaN(now) ? 0 : now - Date.now() };
}

/** Maps a /api/channels/connect-status HTTP response onto a typed outcome. */
function interpretStatusResponse(res: Response, data: Record<string, unknown> | null): StatusOutcome {
  const status = data?.status;
  if (status === "verified" && res.ok && data?.channel) return { kind: "verified", channel: data.channel as ConnectedChannel };
  if (status === "pending") {
    const stage = data?.stage === "verifying" || data?.stage === "awaiting_selection" ? (data.stage as ConnectStage) : undefined;
    return {
      kind: "pending",
      stage,
      lifecycle: typeof data?.state === "string" ? data.state : undefined,
      clock: clockFrom(data),
      ref: typeof data?.ref === "number" ? data.ref : undefined,
    };
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

/** What (if anything) a freshly mounted hook should resume: a "Return to Onfile" launch and/or a stored request. */
function computeResumeTarget(): { token: string | null; ref: number | null; deadline: number } | null {
  const launchRef = getLaunchConnectRef();
  const saved = readPersisted();
  if (launchRef === null && !saved) return null;
  const token = saved?.token ?? null;
  const ref = launchRef ?? saved?.ref ?? null;
  if (!token && ref === null) return null;
  return { token, ref, deadline: saved?.deadline ?? Date.now() + 10 * 60_000 };
}


/**
 * Engine of the bot-guided channel connection ("Connect channel via bot").
 *
 *  1. `start()`   — "Start": POST /api/channels/connect-bot-request creates the secure,
 *                   user-bound request (state `prepared`). No bot message, no countdown.
 *  2. `connect()` — "Connect": POST /api/channels/connect-bot-start starts the server-side
 *                   10-minute window and has the backend deliver the welcome message with
 *                   Telegram's native channel picker. The UI shows the countdown at once, waits
 *                   ~3 s (BOT_NAVIGATION_DELAY_MS, measured from the tap, so a slow backend
 *                   doesn't add to it), then opens the bot chat with
 *                   `Telegram.WebApp.openTelegramLink(botUrl)` — the supported navigation API
 *                   (it does not require a user gesture and does NOT close the Mini App on
 *                   Bot API ≥ 7.0). We never call `close()`: it is not "minimise", and calling
 *                   it before knowing the navigation took effect could strand the user. If
 *                   Telegram refuses the call, or the Mini App is still in the foreground
 *                   a few seconds later, a plain "open the bot" link is shown.
 *  3. The Mini App keeps (or resumes) verifying automatically — a single de-duplicated status
 *     check shared by the poll timer and by every "returned to the Mini App" signal
 *     (visibilitychange / focus / Telegram `activated` / a fresh launch from "Return to
 *     Onfile"). Success is only ever reported after the server says "verified"; the
 *     countdown is cosmetic and never overrides the server's verdict.
 *
 * Used by the onboarding screen (BotConnectInstructions) and by Channel Management
 * (ChannelConnectFlow) so the logic exists exactly once.
 */
export function useChannelConnect(onConnected?: (channel: ConnectedChannel) => void) {
  // A reopened Mini App / "Return to Onfile" launch resumes from the server's state (see the mount effect).
  const [resumeTarget] = useState(() => computeResumeTarget());
  const [state, setState] = useState<BotConnectState>(() => (resumeTarget ? { phase: "resuming" } : { phase: "idle" }));
  const [check, setCheck] = useState<StatusCheckState>(IDLE_CHECK);
  // Latest state for callbacks that must not close over a stale value.
  const stateRef = useRef<BotConnectState>(state);
  useEffect(() => {
    stateRef.current = state;
  });
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollDeadline = useRef<number>(0);
  const returnListenerCleanup = useRef<(() => void) | null>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onConnectedRef = useRef(onConnected);
  useEffect(() => {
    onConnectedRef.current = onConnected;
  });

  /** The request being tracked ("token" or "ref:<n>"); responses for any other key are stale. */
  const activeKey = useRef<string | null>(null);
  const activeToken = useRef<string | null>(null);
  const inFlight = useRef<{ key: string; promise: Promise<StatusOutcome> } | null>(null);
  /** Keys whose terminal outcome was already applied (no duplicate success/haptic/callback). */
  const finished = useRef<Set<string>>(new Set());
  const starting = useRef(false);
  const connecting = useRef(false);
  const mounted = useRef(true);

  const clearHint = useCallback(() => {
    if (hintTimer.current) {
      clearTimeout(hintTimer.current);
      hintTimer.current = null;
    }
  }, []);

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
      clearHint();
    };
  }, [stopPolling, clearHint]);

  const finishFailed = useCallback(
    (key: string, message: string, reason?: string) => {
      finished.current.add(key);
      activeKey.current = null;
      activeToken.current = null;
      stopPolling();
      clearHint();
      persist(null);
      clearLaunchConnectRef();
      triggerHaptic("error");
      setCheck(IDLE_CHECK);
      setState({ phase: "failed", message, reason });
    },
    [stopPolling, clearHint]
  );

  /**
   * Fetches the request's status once and applies it. Concurrent callers for the same
   * request share one network call. Never throws.
   */
  const checkStatus = useCallback(
    (key: string, query: string): Promise<StatusOutcome> => {
      if (inFlight.current && inFlight.current.key === key) return inFlight.current.promise;

      const promise = (async (): Promise<StatusOutcome> => {
        let outcome: StatusOutcome;
        try {
          const res = await fetch(`/api/channels/connect-status?${query}`);
          const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
          outcome = interpretStatusResponse(res, data);
        } catch {
          outcome = { kind: "error" };
        }

        // Stale (superseded / reset / unmounted) or already concluded: report, don't apply.
        if (!mounted.current || activeKey.current !== key || finished.current.has(key)) return outcome;

        switch (outcome.kind) {
          case "verified":
            finished.current.add(key);
            activeKey.current = null;
            activeToken.current = null;
            stopPolling();
            clearHint();
            persist(null);
            clearLaunchConnectRef();
            setCheck(IDLE_CHECK);
            // Success haptic ONLY after the server confirmed the connection.
            triggerHaptic("success");
            setState({ phase: "verified", channel: outcome.channel });
            onConnectedRef.current?.(outcome.channel);
            break;
          case "failed":
            finishFailed(key, outcome.message, outcome.reason);
            break;
          case "expired":
            finishFailed(key, "This connection request expired. Please start again.", "expired");
            break;
          case "unauthorized":
            finishFailed(key, outcome.message, "unauthorized");
            break;
          case "pending": {
            setCheck(IDLE_CHECK);
            if (Date.now() > pollDeadline.current) {
              finishFailed(key, "We didn't detect a channel selection in time. Please start again.", "timeout");
              break;
            }
            const { stage, clock, lifecycle } = outcome;
            setState((prev) => {
              if (prev.phase === "resuming") {
                // Reopened Mini App: rebuild the screen from the SERVER's state.
                const token = activeToken.current;
                if (lifecycle === "prepared" && token && outcome.ref !== undefined) {
                  return { phase: "prepared", token, ref: outcome.ref };
                }
                if (lifecycle === "prepared") return { phase: "idle" };
                const saved = readPersisted();
                return {
                  phase: "waiting_bot",
                  token,
                  ref: outcome.ref ?? saved?.ref ?? null,
                  botUrl: saved?.botUrl ?? null,
                  mode: saved?.mode ?? null,
                  botUsername: saved?.botUsername,
                  clock: clock ?? null,
                  stage,
                };
              }
              if (prev.phase === "waiting_bot") {
                // Keep the existing clock object while the server's expiry is unchanged, so the
                // countdown isn't needlessly re-created on every poll.
                const nextClock = clock && (!prev.clock || prev.clock.expiresAt !== clock.expiresAt) ? clock : prev.clock;
                if (prev.stage === stage && nextClock === prev.clock) return prev;
                return { ...prev, stage, clock: nextClock };
              }
              return prev;
            });
            break;
          }
          case "error":
            if (Date.now() > pollDeadline.current) {
              finishFailed(key, "Network error while checking connection status. Please start again.", "network");
            } else {
              setCheck({ loading: false, tone: "error", message: "Connection problem — retrying automatically…" });
            }
            break;
        }
        return outcome;
      })().finally(() => {
        if (inFlight.current?.key === key) inFlight.current = null;
      });

      inFlight.current = { key, promise };
      return promise;
    },
    [stopPolling, clearHint, finishFailed]
  );

  /** Begins tracking a request (by token and/or public ref) with automatic verification. */
  const startTracking = useCallback(
    (target: { token: string | null; ref: number | null }, deadline: number) => {
      const key = target.token ?? `ref:${target.ref}`;
      const query = target.token ? `token=${encodeURIComponent(target.token)}` : `ref=${target.ref}`;
      pollDeadline.current = deadline;
      activeKey.current = key;
      activeToken.current = target.token;
      stopPolling();
      void checkStatus(key, query);

      // Avoid needless requests: skip ticks while the Mini App is in the background
      // (timers are throttled there anyway); a return signal below checks immediately.
      pollTimer.current = setInterval(() => {
        if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
        void checkStatus(key, query);
      }, POLL_INTERVAL_MS);

      // Automatic verification when the user comes back from the bot chat.
      const onReturn = () => {
        if (document.visibilityState !== "visible") return;
        setCheck({ loading: true, tone: "info", message: null });
        void checkStatus(key, query).finally(() => {
          if (mounted.current) setCheck((c) => (c.loading ? IDLE_CHECK : c));
        });
      };
      document.addEventListener("visibilitychange", onReturn);
      window.addEventListener("focus", onReturn);
      const webApp = getTelegramWebApp();
      try {
        // Bot API 8.0+: fired when the Mini App is brought back to the foreground.
        webApp?.onEvent?.("activated", onReturn);
      } catch {}
      returnListenerCleanup.current = () => {
        document.removeEventListener("visibilitychange", onReturn);
        window.removeEventListener("focus", onReturn);
        try {
          webApp?.offEvent?.("activated", onReturn);
        } catch {}
      };
    },
    [checkStatus, stopPolling]
  );

  // On mount: a fresh launch from "Return to Onfile" (`?connect=<ref>`) or a reopened Mini App
  // with a stored request resumes automatically — the screen is rebuilt from the server's state.
  useEffect(() => {
    if (!resumeTarget) return;
    startTracking({ token: resumeTarget.token, ref: resumeTarget.ref }, resumeTarget.deadline + POLL_GRACE_MS);
    // Only ever run once on mount — subsequent runs are driven by start()/connect().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** "Start": create the secure request (state `prepared`). Nothing is sent to the bot yet. */
  const start = useCallback(async () => {
    if (starting.current) return; // ignore double taps: never two requests
    starting.current = true;
    setCheck(IDLE_CHECK);
    setState({ phase: "preparing" });
    try {
      let res: Response;
      let data: Record<string, unknown>;
      try {
        res = await fetch("/api/channels/connect-bot-request", { method: "POST" });
        data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      } catch {
        triggerHaptic("error");
        setState({ phase: "failed", message: "Network error. Please check your connection and try again." });
        return;
      }
      if (!mounted.current) return;
      if (!res.ok || typeof data.token !== "string" || typeof data.ref !== "number") {
        triggerHaptic("error");
        setState({
          phase: "failed",
          message: (typeof data.error === "string" && data.error) || "Could not prepare the connection. Please try again.",
          reason: typeof data.reason === "string" ? data.reason : undefined,
        });
        return;
      }
      persist({
        token: data.token,
        ref: data.ref,
        deadline: Date.now() + 10 * 60_000,
        botUsername: typeof data.botUsername === "string" ? data.botUsername : undefined,
      });
      setState({
        phase: "prepared",
        token: data.token,
        ref: data.ref,
        botUsername: typeof data.botUsername === "string" ? data.botUsername : undefined,
      });
    } finally {
      starting.current = false;
    }
  }, []);

  /** "Connect": start the server-side countdown, deliver the bot message, open the bot chat. */
  const connect = useCallback(async () => {
    if (connecting.current) return; // double tap: one request, one chat
    const current = stateRef.current;
    if (current.phase !== "prepared") return;
    connecting.current = true;
    const { token, ref, botUsername } = current;
    const tappedAt = Date.now();
    setCheck(IDLE_CHECK);
    // Countdown starts immediately (optimistic 10:00); re-synced to the server clock below.
    setState({ phase: "connecting", token, ref, botUsername, clock: { expiresAt: tappedAt + 10 * 60_000, offset: 0 } });
    try {
      let res: Response;
      let data: Record<string, unknown>;
      try {
        res = await fetch("/api/channels/connect-bot-start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      } catch {
        triggerHaptic("error");
        if (mounted.current) setState({ phase: "prepared", token, ref, botUsername, error: "Network error. Please check your connection and try again." });
        return;
      }
      if (!mounted.current) return;

      if (!res.ok || typeof data.botUrl !== "string") {
        triggerHaptic("error");
        const terminal = res.status === 404 || res.status === 409 || res.status === 410 || res.status === 401;
        const message = (typeof data.error === "string" && data.error) || "Could not open the Onfile Bot. Please try again.";
        if (terminal) {
          persist(null);
          setState({ phase: "failed", message, reason: typeof data.state === "string" ? data.state : undefined });
        } else {
          // The server rolled the request back to `prepared`: "Connect" can simply be tapped again.
          setState({ phase: "prepared", token, ref, botUsername, error: message });
        }
        return;
      }

      const botUrl = data.botUrl;
      const mode: BotConnectMode = data.mode === "existing_chat" ? "existing_chat" : "start_link";
      const resolvedUsername = typeof data.botUsername === "string" ? data.botUsername : botUsername;
      const clock = clockFrom(data) ?? { expiresAt: tappedAt + 10 * 60_000, offset: 0 };
      setState({ phase: "connecting", token, ref, botUsername: resolvedUsername, clock });

      // ~3 s UX delay, measured from the tap.
      await sleep(Math.max(0, BOT_NAVIGATION_DELAY_MS - (Date.now() - tappedAt)));
      if (!mounted.current) return;

      persist({ token, ref, deadline: clock.expiresAt - clock.offset + POLL_GRACE_MS, botUrl, mode, botUsername: resolvedUsername });
      setState({ phase: "waiting_bot", token, ref, botUrl, mode, botUsername: resolvedUsername, clock, stage: "awaiting_selection" });
      startTracking({ token, ref }, clock.expiresAt - clock.offset + POLL_GRACE_MS);

      // Subtle haptic, then navigate. The supported API is openTelegramLink; no close().
      triggerHaptic("impact");
      const opened = openTelegramBotLink(botUrl);
      if (!opened) {
        triggerHaptic("warning");
        setState((prev) => (prev.phase === "waiting_bot" && prev.token === token ? { ...prev, openFailed: true } : prev));
        return;
      }
      clearHint();
      hintTimer.current = setTimeout(() => {
        hintTimer.current = null;
        if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
        setState((prev) => (prev.phase === "waiting_bot" && prev.token === token ? { ...prev, stillVisible: true } : prev));
      }, FOREGROUND_HINT_MS);
    } finally {
      connecting.current = false;
    }
  }, [startTracking, clearHint]);

  /** Immediately re-checks the server-side status (used e.g. when the local countdown hits zero). */
  const refresh = useCallback(async () => {
    const token = activeToken.current ?? readPersisted()?.token ?? null;
    const key = activeKey.current;
    if (!key) return;
    const query = token ? `token=${encodeURIComponent(token)}` : key.startsWith("ref:") ? `ref=${key.slice(4)}` : "";
    if (!query) return;
    await checkStatus(key, query);
  }, [checkStatus]);

  const reset = useCallback(() => {
    // Abandon a still-pending request on the server too, rather than leaving it claimable.
    const token = activeToken.current ?? readPersisted()?.token ?? null;
    if (token) notifyCancelled(token);
    stopPolling();
    clearHint();
    activeKey.current = null;
    activeToken.current = null;
    persist(null);
    clearLaunchConnectRef();
    setCheck(IDLE_CHECK);
    setState({ phase: "idle" });
  }, [stopPolling, clearHint]);

  return { state, check, start, connect, refresh, reset };
}
