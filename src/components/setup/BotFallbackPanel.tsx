"use client";
import React from "react";
import { Bot, Loader2, XCircle } from "lucide-react";
import type { BotConnectState, StatusCheckState } from "@/lib/useChannelConnect";

type Handlers = {
  onConnectViaBot: () => void;
  onRefresh: () => void;
  onCancel: () => void;
};

/** The phases this panel owns (the bot-chat fallback). */
export function isBotFallbackPhase(state: BotConnectState): boolean {
  return state.phase === "bot_fallback" || state.phase === "opening_bot" || state.phase === "waiting_bot";
}

const IDLE_CHECK: StatusCheckState = { loading: false, message: null, tone: "info" };

/**
 * UI for the "Connect channel via bot" fallback, shown when Telegram's
 * Direct Channel Picker is unavailable on the user's client. Shared by the
 * onboarding screen (BotConnectInstructions) and Channel Management
 * (ChannelConnectFlow).
 *
 * Deliberately minimal: there is exactly ONE primary action — "Connect channel
 * via bot" — which prepares the request, sends the keyboard (or the signed
 * first-time Start flow), gives haptic feedback and opens the bot chat by
 * itself. There is no explanatory card and no "open the chat again" button.
 * Errors and expiry are shown by the parent and are retried with this same
 * primary action.
 */
export default function BotFallbackPanel({
  state,
  check = IDLE_CHECK,
  onConnectViaBot,
  onRefresh,
  onCancel,
}: { state: BotConnectState; check?: StatusCheckState } & Handlers) {
  if (state.phase === "bot_fallback") {
    return (
      <div className="flex flex-col gap-3" data-testid="bot-fallback">
        <button
          onClick={onConnectViaBot}
          className="btn-primary w-full py-4 text-base font-bold flex items-center justify-center gap-2.5 shadow-app-md"
        >
          <Bot size={20} />
          Connect channel via bot
        </button>
      </div>
    );
  }

  if (state.phase === "opening_bot") {
    return (
      <div className="flex flex-col gap-3" data-testid="bot-opening">
        <button
          disabled
          className="btn-primary w-full py-4 text-base font-bold flex items-center justify-center gap-2.5 opacity-70"
        >
          <Loader2 size={18} className="animate-spin" />
          Opening Onfile Bot…
        </button>
      </div>
    );
  }

  if (state.phase === "waiting_bot") {
    const verifying = state.stage === "verifying";
    const botHandle = state.botUsername ? `@${state.botUsername}` : "the Onfile Bot";
    return (
      <div className="flex flex-col items-center gap-3 py-1" data-testid="bot-waiting">
        <div className="flex items-center justify-center gap-2 text-sm text-secondary" role="status">
          <Loader2 size={16} className="animate-spin text-brand" />
          <span className="font-medium text-primary">
            {verifying ? "Channel selected — verifying..." : "Waiting for channel selection..."}
          </span>
        </div>

        {state.openFailed && (
          <p className="text-center text-xs text-red-500" data-testid="bot-open-failed" role="alert">
            Telegram didn&apos;t open the chat automatically. Open {botHandle} in Telegram
            {state.mode === "start_link" ? " and tap Start." : " and tap “Select channel to connect”."}
          </p>
        )}

        <button
          onClick={onRefresh}
          disabled={check.loading}
          className="text-xs font-semibold text-brand text-center flex items-center justify-center gap-1.5 disabled:opacity-60"
        >
          {check.loading && <Loader2 size={12} className="animate-spin" />}
          {check.loading ? "Checking..." : "I've finished in the bot — check status"}
        </button>

        {check.message && !check.loading && (
          <p
            className={`text-center text-xs ${check.tone === "error" ? "text-red-500" : "text-secondary"}`}
            data-testid="bot-check-message"
            role="status"
          >
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
 * Failure / expiry state of the bot fallback: a clear message plus the SAME
 * primary action ("Connect channel via bot") to retry — no separate
 * "try again" or "open chat again" button.
 */
export function BotConnectFailure({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col gap-3" data-testid="bot-failed">
      <div className="flex items-start gap-2 text-left text-xs text-red-500 bg-red-50 dark:bg-red-900/20 rounded-xl p-3" role="alert">
        <XCircle size={14} className="mt-0.5 flex-shrink-0" />
        <span>{message}</span>
      </div>
      <button
        onClick={onRetry}
        className="btn-primary w-full py-4 text-base font-bold flex items-center justify-center gap-2.5 shadow-app-md"
      >
        <Bot size={20} />
        Connect channel via bot
      </button>
    </div>
  );
}
