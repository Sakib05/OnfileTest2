"use client";
import React from "react";
import { Loader2, Radio, ShieldCheck, XCircle } from "lucide-react";
import BotFallbackPanel, { BotConnectFailure, isBotFallbackPhase } from "@/components/setup/BotFallbackPanel";
import ConnectSuccessNotice from "@/components/setup/ConnectSuccessNotice";
import { isRequestChatSupported, isRunningInsideTelegram } from "@/lib/telegramWebApp";
import { useChannelConnect, type ConnectedChannel } from "@/lib/useChannelConnect";

export type { ConnectedChannel } from "@/lib/useChannelConnect";

/**
 * The native Telegram direct channel-picker connection experience: tapping
 * "Connect Telegram Channel" opens Telegram's own chat-selection screen
 * immediately (via `Telegram.WebApp.requestChat`, backed by a prepared
 * `request_chat` keyboard button — see src/lib/telegramBot.ts), followed by
 * Telegram's own "add as administrator" screen if needed. Neither screen is
 * rendered by Onfile; this component only kicks the flow off and polls for
 * the backend's independently verified result. Used by Channel Management
 * ("connect another channel"); the first-time onboarding flow uses the same
 * underlying `useChannelConnect` engine via `BotConnectInstructions`.
 */
export default function ChannelConnectFlow({
  onConnected,
}: {
  onConnected?: (channel: ConnectedChannel) => void;
}) {
  const { state, check, start, startViaBot, refresh, reset } = useChannelConnect(onConnected);

  if (!isRunningInsideTelegram()) {
    return (
      <div className="flex items-start gap-2 text-left text-xs text-secondary bg-secondary rounded-xl p-3">
        <Radio size={14} className="mt-0.5 flex-shrink-0 text-brand" />
        <span>Open Onfile from inside Telegram to connect a channel. This screen cannot access Telegram&apos;s native chat selector in a regular browser tab.</span>
      </div>
    );
  }

  // Clients without the Direct Picker only have the bot option: retry with that same primary action.
  const botOnly = !isRequestChatSupported();

  return (
    <div className="flex flex-col gap-4 w-full">
      {state.phase === "idle" && (
        <button onClick={start} className="btn-primary w-full py-3 text-sm flex items-center justify-center gap-2">
          <Radio size={16} />
          Connect Telegram Channel
        </button>
      )}

      {state.phase === "starting" && (
        <button disabled className="btn-primary w-full py-3 text-sm flex items-center justify-center gap-2 opacity-70">
          <Loader2 size={16} className="animate-spin" />
          Starting...
        </button>
      )}

      {state.phase === "waiting" && (
        <div className="flex flex-col gap-3">
          <div className="flex items-start gap-2 text-left text-xs text-secondary bg-secondary rounded-xl p-3">
            <Loader2 size={14} className="mt-0.5 flex-shrink-0 animate-spin text-brand" />
            <div>
              <p className="font-semibold text-primary text-xs">
                {state.stage === "verifying" ? "Channel selected — verifying…" : "Waiting for channel selection…"}
              </p>
              <p className="mt-0.5">This page updates automatically. Please wait.</p>
            </div>
          </div>
          <button onClick={reset} className="text-xs font-semibold text-secondary text-center">
            Cancel
          </button>
        </div>
      )}

      {isBotFallbackPhase(state) && (
        <BotFallbackPanel
          state={state}
          check={check}
          onConnectViaBot={startViaBot}
          onRefresh={refresh}
          onCancel={reset}
        />
      )}

      {state.phase === "verified" && <ConnectSuccessNotice channel={state.channel} />}

      {state.phase === "failed" &&
        (botOnly ? (
          <BotConnectFailure message={state.message} onRetry={startViaBot} />
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-start gap-2 text-left text-xs text-red-500 bg-red-50 dark:bg-red-900/20 rounded-xl p-3">
              <XCircle size={14} className="mt-0.5 flex-shrink-0" />
              <span>{state.message}</span>
            </div>
            <button onClick={reset} className="btn-primary w-full py-3 text-sm">
              Try Again
            </button>
          </div>
        ))}

      <div className="flex items-start gap-2 text-left text-[11px] text-muted">
        <ShieldCheck size={13} className="mt-0.5 flex-shrink-0" />
        <span>Onfile only requests permission for the bot to post messages in your private channel — nothing more.</span>
      </div>
    </div>
  );
}
