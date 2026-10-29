"use client";
import React from "react";
import { CheckCircle2, Loader2, MessageCircle, Radio, ShieldCheck, XCircle } from "lucide-react";
import { isRunningInsideTelegram } from "@/lib/telegramWebApp";
import { useChannelConnect, type ConnectedChannel } from "@/lib/useChannelConnect";

export type { ConnectedChannel } from "@/lib/useChannelConnect";

/**
 * The two-step native Telegram channel connection experience:
 *   1. Select Chat  — Telegram's own chat picker (request_chat keyboard
 *      button), filtered to channels the user administers.
 *   2. Add Bot       — Telegram's own "add as administrator" screen, shown
 *      automatically by Telegram when the bot isn't already an admin with
 *      the requested rights.
 * Neither screen is rendered by Onfile; this component only kicks the flow
 * off and polls for the backend's independently verified result. Used by
 * Channel Management ("connect another channel"); the first-time onboarding
 * flow uses the same underlying `useChannelConnect` engine via
 * `BotConnectInstructions`.
 */
export default function ChannelConnectFlow({
  onConnected,
}: {
  onConnected?: (channel: ConnectedChannel) => void;
}) {
  const { state, start, reopenBotChat, reset } = useChannelConnect(onConnected);

  if (!isRunningInsideTelegram()) {
    return (
      <div className="flex items-start gap-2 text-left text-xs text-secondary bg-secondary rounded-xl p-3">
        <Radio size={14} className="mt-0.5 flex-shrink-0 text-brand" />
        <span>Open Onfile from inside Telegram to connect a channel. This screen cannot access Telegram&apos;s native chat selector in a regular browser tab.</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 w-full">
      {/* Step indicator */}
      <div className="flex items-center gap-2 text-xs font-medium">
        <StepPill active={state.phase !== "idle"} label="1. Select Chat" />
        <div className="h-px flex-1 bg-app" />
        <StepPill active={state.phase === "verified"} label="2. Add Bot" />
      </div>

      {state.phase === "idle" && (
        <button onClick={start} className="btn-primary w-full py-3 text-sm flex items-center justify-center gap-2">
          <MessageCircle size={16} />
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
            <span>
              We opened your chat with the Onfile bot. Tap <strong>&ldquo;Select channel to connect&rdquo;</strong>, choose your private channel, and
              confirm adding the bot as an administrator if asked. This screen updates automatically once Telegram confirms it.
            </span>
          </div>
          <button onClick={() => reopenBotChat(state.botUsername)} className="btn-secondary w-full py-2.5 text-sm">
            Reopen Onfile Bot Chat
          </button>
        </div>
      )}

      {state.phase === "needs_bot_chat" && (
        <div className="flex flex-col gap-3">
          <div className="flex items-start gap-2 text-left text-xs text-secondary bg-secondary rounded-xl p-3">
            <XCircle size={14} className="mt-0.5 flex-shrink-0 text-brand" />
            <span>Telegram bots can only message you after you&apos;ve started a chat with them. Open the Onfile bot chat, tap Start, then try again.</span>
          </div>
          <button onClick={() => reopenBotChat(state.botUsername)} className="btn-primary w-full py-3 text-sm">
            Open Onfile Bot Chat
          </button>
          <button onClick={reset} className="btn-secondary w-full py-2.5 text-sm">
            Try Again
          </button>
        </div>
      )}

      {state.phase === "verified" && (
        <div className="flex flex-col items-center gap-2 text-center bg-secondary rounded-xl p-4">
          <CheckCircle2 size={28} className="text-green-500" />
          <p className="text-sm font-semibold text-primary">
            {state.channel.channelName || state.channel.channelUsername || "Channel"} connected
          </p>
          <p className="text-xs text-secondary">Onfile verified the bot&apos;s administrator access to this channel.</p>
        </div>
      )}

      {state.phase === "failed" && (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-red-500 text-center">{state.message}</p>
          <button onClick={reset} className="btn-primary w-full py-3 text-sm">
            Try Again
          </button>
        </div>
      )}

      <div className="flex items-start gap-2 text-left text-[11px] text-muted">
        <ShieldCheck size={13} className="mt-0.5 flex-shrink-0" />
        <span>Onfile only requests permission for the bot to post messages in your private channel — nothing more.</span>
      </div>
    </div>
  );
}

function StepPill({ active, label }: { active: boolean; label: string }) {
  return (
    <span className={active ? "chip bg-brand-10 text-brand" : "chip bg-secondary text-secondary"}>{label}</span>
  );
}
