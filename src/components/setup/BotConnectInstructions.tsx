"use client";
import React from "react";
import { ArrowLeft, Loader2, MessageCircle, MousePointerClick, ShieldCheck, Send, XCircle } from "lucide-react";
import { isRunningInsideTelegram } from "@/lib/telegramWebApp";
import { useChannelConnect, type ConnectedChannel } from "@/lib/useChannelConnect";

/**
 * Dedicated instruction screen shown before Onfile hands off to Telegram's
 * native chat-selection flow (distinct from the general "How to connect?"
 * guide). Mirrors the product reference (https://ibb.co/fzCZbbRw): a short
 * explanation, simple numbered visual steps, and a single primary action
 * button at the bottom.
 */
export default function BotConnectInstructions({
  onBack,
  onSuccess,
}: {
  onBack: () => void;
  onSuccess: (channel: ConnectedChannel) => void;
}) {
  const { state, start, reopenBotChat, reset } = useChannelConnect(onSuccess);

  const insideTelegram = isRunningInsideTelegram();

  return (
    <div className="flex flex-col gap-5 w-full max-w-sm">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center flex-shrink-0">
          <ArrowLeft size={16} style={{ color: "var(--color-text)" }} />
        </button>
        <h1 className="text-lg font-bold text-primary">Connect Your Telegram Channel</h1>
      </div>

      <p className="text-sm text-secondary leading-relaxed">
        Onfile will open your chat with the Onfile bot. From there, tap the button Telegram shows you to pick a
        private channel you administer, then confirm adding the bot as an administrator.
      </p>

      <div className="bg-card rounded-2xl border border-app shadow-app-sm p-4 flex flex-col gap-4">
        <InstructionStep
          icon={Send}
          step={1}
          title="Open the bot chat"
          description={'Tap "Connect Channel" below — Onfile opens your private chat with the Onfile bot.'}
        />
        <InstructionStep
          icon={MousePointerClick}
          step={2}
          title="Select your channel"
          description={'Tap "Select channel to connect" and choose an eligible private channel using Telegram\'s own picker.'}
        />
        <InstructionStep
          icon={ShieldCheck}
          step={3}
          title="Approve bot access"
          description="If asked, confirm adding Onfile's bot as an administrator with permission to post messages."
        />
      </div>

      {!insideTelegram ? (
        <div className="flex items-start gap-2 text-left text-xs text-secondary bg-secondary rounded-xl p-3">
          <XCircle size={14} className="mt-0.5 flex-shrink-0 text-brand" />
          <span>Open Onfile from inside Telegram to use the native channel picker.</span>
        </div>
      ) : (
        <>
          {state.phase === "idle" && (
            <button onClick={start} className="btn-primary w-full py-3.5 text-sm font-semibold">
              Connect Channel
            </button>
          )}

          {state.phase === "starting" && (
            <button disabled className="btn-primary w-full py-3.5 text-sm font-semibold flex items-center justify-center gap-2 opacity-70">
              <Loader2 size={16} className="animate-spin" />
              Starting...
            </button>
          )}

          {state.phase === "waiting" && (
            <div className="flex flex-col gap-3">
              <div className="flex items-start gap-2 text-left text-xs text-secondary bg-secondary rounded-xl p-3">
                <Loader2 size={14} className="mt-0.5 flex-shrink-0 animate-spin text-brand" />
                <span>
                  Waiting for you to select a channel in Telegram and, if needed, approve the bot&apos;s admin
                  access. This updates automatically — no need to keep this screen open.
                </span>
              </div>
              <button onClick={() => reopenBotChat(state.botUsername)} className="btn-secondary w-full py-3 text-sm font-semibold flex items-center justify-center gap-2">
                <MessageCircle size={15} />
                Reopen Onfile Bot Chat
              </button>
              <button onClick={reset} className="text-xs font-semibold text-secondary text-center">
                Cancel
              </button>
            </div>
          )}

          {state.phase === "needs_bot_chat" && (
            <div className="flex flex-col gap-3">
              <div className="flex items-start gap-2 text-left text-xs text-secondary bg-secondary rounded-xl p-3">
                <XCircle size={14} className="mt-0.5 flex-shrink-0 text-brand" />
                <span>Telegram bots can only message you after you&apos;ve started a chat with them. Open the bot chat, tap Start, then try again.</span>
              </div>
              <button onClick={() => reopenBotChat(state.botUsername)} className="btn-primary w-full py-3.5 text-sm font-semibold">
                Open Onfile Bot Chat
              </button>
              <button onClick={reset} className="btn-secondary w-full py-3 text-sm font-semibold">
                Try Again
              </button>
            </div>
          )}

          {state.phase === "failed" && (
            <div className="flex flex-col gap-3">
              <div className="flex items-start gap-2 text-left text-xs text-red-500 bg-red-50 dark:bg-red-900/20 rounded-xl p-3">
                <XCircle size={14} className="mt-0.5 flex-shrink-0" />
                <span>{state.message}</span>
              </div>
              <button onClick={reset} className="btn-primary w-full py-3.5 text-sm font-semibold">
                Try Again
              </button>
              <button onClick={onBack} className="text-xs font-semibold text-secondary text-center">
                Back to Channel Connect
              </button>
            </div>
          )}
        </>
      )}

      <div className="flex items-start gap-2 text-left text-[11px] text-muted">
        <ShieldCheck size={13} className="mt-0.5 flex-shrink-0" />
        <span>Onfile only requests permission for the bot to post messages in your private channel — nothing more. You stay the channel&apos;s owner at all times.</span>
      </div>
    </div>
  );
}

function InstructionStep({
  icon: Icon,
  step,
  title,
  description,
}: {
  icon: React.FC<{ size: number; className?: string }>;
  step: number;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-8 h-8 rounded-full gradient-brand text-white text-xs font-bold flex items-center justify-center flex-shrink-0 relative">
        {step}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <Icon size={13} className="text-brand" />
          <p className="text-sm font-semibold text-primary">{title}</p>
        </div>
        <p className="text-xs text-secondary mt-0.5 leading-relaxed">{description}</p>
      </div>
    </div>
  );
}
