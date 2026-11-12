"use client";
import React from "react";
import { Bot, ExternalLink, Loader2 } from "lucide-react";
import type { BotConnectState } from "@/lib/useChannelConnect";

type Handlers = {
  onConnectViaBot: () => void;
  onReopenBot: (botUrl: string) => void;
  onRefresh: () => void;
  onCancel: () => void;
};

/** The phases this panel owns (the bot-chat fallback). */
export function isBotFallbackPhase(state: BotConnectState): boolean {
  return state.phase === "bot_fallback" || state.phase === "opening_bot" || state.phase === "waiting_bot";
}

/**
 * UI for the "Connect channel via bot" fallback, shown when Telegram's
 * Direct Channel Picker is unavailable on the user's client. Replaces the
 * former "Telegram Update Required" dead-end. Shared by the onboarding screen
 * (BotConnectInstructions) and Channel Management (ChannelConnectFlow).
 *
 * Copy is deliberately honest: opening the bot chat does NOT open the picker.
 * The picker opens when the user taps the keyboard button the bot sends.
 */
export default function BotFallbackPanel({ state, onConnectViaBot, onReopenBot, onRefresh, onCancel }: { state: BotConnectState } & Handlers) {
  if (state.phase === "bot_fallback") {
    return (
      <div className="flex flex-col gap-3" data-testid="bot-fallback">
        <div className="flex items-start gap-2 text-left text-xs text-secondary bg-secondary rounded-xl p-3">
          <Bot size={14} className="mt-0.5 flex-shrink-0 text-brand" />
          <div>
            <p className="font-semibold text-primary text-xs">Connect through the Onfile Bot</p>
            <p className="mt-0.5">
              Direct channel selection isn&apos;t available in your Telegram app, but you can still connect your
              channel by chatting with the Onfile Bot — no Telegram update needed.
            </p>
          </div>
        </div>
        <button
          onClick={onConnectViaBot}
          className="btn-primary w-full py-3.5 text-sm font-semibold flex items-center justify-center gap-2"
        >
          <Bot size={16} />
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
          className="btn-primary w-full py-3.5 text-sm font-semibold flex items-center justify-center gap-2 opacity-70"
        >
          <Loader2 size={16} className="animate-spin" />
          Opening Onfile Bot…
        </button>
      </div>
    );
  }

  if (state.phase === "waiting_bot") {
    const verifying = state.stage === "verifying";
    return (
      <div className="flex flex-col gap-3" data-testid="bot-waiting">
        <div className="flex items-start gap-2 text-left text-xs text-secondary bg-secondary rounded-xl p-3">
          <Loader2 size={14} className="mt-0.5 flex-shrink-0 animate-spin text-brand" />
          {verifying ? (
            <div>
              <p className="font-semibold text-primary text-xs">Channel selected — verifying…</p>
              <p className="mt-0.5">Checking the channel and the bot&apos;s permissions with Telegram.</p>
            </div>
          ) : (
            <div>
              <p className="font-semibold text-primary text-xs">Waiting for channel selection in the bot chat…</p>
              <ol className="mt-1 list-decimal pl-4 flex flex-col gap-0.5">
                <li>In the Onfile Bot chat, tap Start if Telegram shows it.</li>
                <li>Tap “Select channel to connect” and choose your private channel.</li>
                <li>Come back to Onfile — this page updates automatically.</li>
              </ol>
            </div>
          )}
        </div>
        {!verifying && (
          <button
            onClick={() => onReopenBot(state.botUrl)}
            className="btn-secondary w-full py-2.5 text-sm flex items-center justify-center gap-2"
          >
            <ExternalLink size={14} />
            Open bot chat again
          </button>
        )}
        <button onClick={onRefresh} className="text-xs font-semibold text-brand text-center">
          I&apos;ve finished in the bot — check status
        </button>
        <button onClick={onCancel} className="text-xs font-semibold text-secondary text-center">
          Cancel
        </button>
      </div>
    );
  }

  return null;
}
