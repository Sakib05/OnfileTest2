"use client";
import React, { useEffect, useRef, useState } from "react";
import { Bot, Clock, Loader2, XCircle } from "lucide-react";
import type { BotConnectState, ServerClock, StatusCheckState } from "@/lib/useChannelConnect";
import { formatCountdown, remainingSeconds } from "@/lib/botConnectClient";
import { openTelegramBotLink } from "@/lib/telegramWebApp";

type Handlers = {
  /** "Start": create the secure connection request. */
  onStart: () => void;
  /** "Connect": start the countdown, open the bot chat. */
  onConnect: () => void;
  /** Re-check the server-side status right now. */
  onRefresh: () => void;
  onCancel: () => void;
};

/** The phases this panel owns (every phase of the bot-guided flow except success/failure). */
export function isBotFallbackPhase(state: BotConnectState): boolean {
  return (
    state.phase === "idle" ||
    state.phase === "preparing" ||
    state.phase === "prepared" ||
    state.phase === "connecting" ||
    state.phase === "waiting_bot" ||
    state.phase === "resuming"
  );
}

const IDLE_CHECK: StatusCheckState = { loading: false, message: null, tone: "info" };

/**
 * Ticks once a second and shows the time left in the SERVER-enforced window
 * (mm:ss). It is purely a display: when it reaches 00:00 it only asks the server
 * for the real status (once) — the server, not this timer, decides "expired".
 */
export function Countdown({ clock, onZero }: { clock: ServerClock; onZero?: () => void }) {
  const [secs, setSecs] = useState(() => remainingSeconds(clock));
  const zeroFired = useRef(false);
  const onZeroRef = useRef(onZero);
  useEffect(() => {
    onZeroRef.current = onZero;
  });

  useEffect(() => {
    zeroFired.current = false;
    const tick = () => {
      const left = remainingSeconds(clock);
      setSecs(left);
      if (left <= 0 && !zeroFired.current) {
        zeroFired.current = true;
        onZeroRef.current?.();
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [clock]);

  return (
    <div
      className="flex items-center justify-center gap-1.5 text-xs text-secondary"
      role="timer"
      aria-label="Time remaining to connect your channel"
      data-testid="connect-countdown"
    >
      <Clock size={13} className="text-brand" />
      <span>Time remaining</span>
      <span className="font-semibold tabular-nums text-primary" data-testid="connect-countdown-value">
        {formatCountdown(secs)}
      </span>
    </div>
  );
}

/**
 * UI of the bot-guided connection ("Connect channel via bot"), shared by the
 * onboarding screen (BotConnectInstructions) and Channel Management
 * (ChannelConnectFlow). The existing instruction card stays where it is; this
 * panel only owns the action area below it:
 *
 *   "Start"  →  "Connect"  →  countdown + "Opening Onfile Bot…"  →
 *   "Waiting for channel selection…" / "Verifying your connection…"
 *
 * Deliberately minimal — no extra cards or navigation buttons. Failures and
 * expiry are shown by the parent (BotConnectFailure) and retried with "Start".
 */
export default function BotFallbackPanel({
  state,
  check = IDLE_CHECK,
  onStart,
  onConnect,
  onRefresh,
  onCancel,
}: { state: BotConnectState; check?: StatusCheckState } & Handlers) {
  if (state.phase === "idle") {
    return (
      <div className="flex flex-col gap-3" data-testid="bot-start">
        <button onClick={onStart} className="btn-primary w-full py-4 text-base font-bold flex items-center justify-center gap-2.5 shadow-app-md">
          <Bot size={20} />
          Start
        </button>
      </div>
    );
  }

  if (state.phase === "preparing") {
    return (
      <div className="flex flex-col gap-3" data-testid="bot-preparing">
        <button disabled className="btn-primary w-full py-4 text-base font-bold flex items-center justify-center gap-2.5 opacity-70">
          <Loader2 size={18} className="animate-spin" />
          Preparing…
        </button>
      </div>
    );
  }

  if (state.phase === "prepared") {
    return (
      <div className="flex flex-col gap-3" data-testid="bot-prepared">
        {state.error && (
          <div className="flex items-start gap-2 text-left text-xs text-red-500 bg-red-50 dark:bg-red-900/20 rounded-xl p-3" role="alert" data-testid="bot-connect-error">
            <XCircle size={14} className="mt-0.5 flex-shrink-0" />
            <span>{state.error}</span>
          </div>
        )}
        <button onClick={onConnect} className="btn-primary w-full py-4 text-base font-bold flex items-center justify-center gap-2.5 shadow-app-md">
          <Bot size={20} />
          Connect
        </button>
        <button onClick={onCancel} className="text-xs font-semibold text-secondary text-center">
          Cancel
        </button>
      </div>
    );
  }

  if (state.phase === "connecting") {
    return (
      <div className="flex flex-col gap-3" data-testid="bot-opening">
        <Countdown clock={state.clock} onZero={onRefresh} />
        <button disabled className="btn-primary w-full py-4 text-base font-bold flex items-center justify-center gap-2.5 opacity-70">
          <Loader2 size={18} className="animate-spin" />
          Opening Onfile Bot…
        </button>
      </div>
    );
  }

  if (state.phase === "resuming") {
    return (
      <div className="flex items-center justify-center gap-2 text-sm text-secondary py-2" role="status" data-testid="bot-resuming">
        <Loader2 size={16} className="animate-spin text-brand" />
        <span className="font-medium text-primary">Verifying your connection...</span>
      </div>
    );
  }

  if (state.phase === "waiting_bot") {
    const verifying = state.stage === "verifying";
    const botHandle = state.botUsername ? `@${state.botUsername}` : "the Onfile Bot";
    const statusText = check.loading
      ? "Verifying your connection..."
      : verifying
        ? "Channel selected — verifying..."
        : "Waiting for channel selection...";
    return (
      <div className="flex flex-col items-center gap-3 py-1" data-testid="bot-waiting">
        {state.clock && <Countdown clock={state.clock} onZero={onRefresh} />}

        <div className="flex items-center justify-center gap-2 text-sm text-secondary" role="status">
          <Loader2 size={16} className="animate-spin text-brand" />
          <span className="font-medium text-primary">{statusText}</span>
        </div>

        {state.openFailed && (
          <p className="text-center text-xs text-red-500" data-testid="bot-open-failed" role="alert">
            Telegram didn&apos;t open the chat automatically. Open {botHandle} in Telegram
            {state.mode === "start_link" ? " and tap Start." : " and tap “Select channel to connect”."}
          </p>
        )}

        {state.botUrl && (state.openFailed || state.stillVisible) && (
          <a
            href={state.botUrl}
            target="_blank"
            rel="noreferrer"
            data-testid="bot-open-link"
            onClick={(e) => {
              // A real tap is a genuine user gesture: try Telegram's own navigation first.
              if (state.botUrl && openTelegramBotLink(state.botUrl)) e.preventDefault();
            }}
            className="text-center text-xs font-semibold text-brand underline"
          >
            Didn&apos;t switch to Telegram? Tap here to open {botHandle}
          </a>
        )}

        {check.message && !check.loading && (
          <p className={`text-center text-xs ${check.tone === "error" ? "text-red-500" : "text-secondary"}`} data-testid="bot-check-message" role="status">
            {check.message}
          </p>
        )}

        <button onClick={onCancel} className="text-xs font-semibold text-secondary text-center">
          Cancel
        </button>
      </div>
    );
  }

  return null;
}

/**
 * Failure / expiry / cancellation: a clear message plus the SAME primary action
 * ("Start") to begin a fresh attempt.
 */
export function BotConnectFailure({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col gap-3" data-testid="bot-failed">
      <div className="flex items-start gap-2 text-left text-xs text-red-500 bg-red-50 dark:bg-red-900/20 rounded-xl p-3" role="alert">
        <XCircle size={14} className="mt-0.5 flex-shrink-0" />
        <span>{message}</span>
      </div>
      <button onClick={onRetry} className="btn-primary w-full py-4 text-base font-bold flex items-center justify-center gap-2.5 shadow-app-md">
        <Bot size={20} />
        Start
      </button>
    </div>
  );
}
