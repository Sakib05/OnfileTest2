"use client";
import React from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Loader2,
  MousePointerClick,
  RefreshCw,
  ShieldCheck,
  UserCog,
  XCircle,
} from "lucide-react";
import { isRunningInsideTelegram } from "@/lib/telegramWebApp";
import { useChannelConnect, type ConnectedChannel } from "@/lib/useChannelConnect";

interface InstructionStepData {
  icon: React.FC<{ size: number; className?: string }>;
  title: string;
  description: string;
}

/**
 * The five required steps for "Connect Channel via Bot" (Part B of the
 * channel connection system). These describe exactly what happens with the
 * direct native picker flow: tapping "Connect Channel" below calls
 * `Telegram.WebApp.requestChat` immediately — there is no bot chat to open
 * and no second button to tap inside it.
 */
const STEPS: InstructionStepData[] = [
  {
    icon: MousePointerClick,
    title: "Tap Connect Channel",
    description: "Start the channel connection process.",
  },
  {
    icon: MousePointerClick,
    title: "Select Your Private Channel",
    description: "Choose the private Telegram channel you want to connect.",
  },
  {
    icon: ShieldCheck,
    title: "Review the Requested Permissions",
    description: "Check the permissions Onfile needs to manage your channel connection.",
  },
  {
    icon: UserCog,
    title: "Add Onfile Bot as an Administrator",
    description: "Confirm the requested administrator access.",
  },
  {
    icon: RefreshCw,
    title: "Return to Onfile and Wait for Confirmation",
    description: "Your connection status will update automatically.",
  },
];

/**
 * Dedicated instruction screen shown before Onfile hands off to Telegram's
 * native direct chat-selection flow (distinct from the Manual Connect
 * step-by-step guide). Shows the five required steps, then a single primary
 * action button at the bottom.
 */
export default function BotConnectInstructions({
  onBack,
  onSuccess,
}: {
  onBack: () => void;
  onSuccess: (channel: ConnectedChannel) => void;
}) {
  const { state, start, reset } = useChannelConnect(onSuccess);

  const insideTelegram = isRunningInsideTelegram();

  return (
    <div className="flex flex-col gap-5 w-full max-w-sm">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center flex-shrink-0">
          <ArrowLeft size={16} style={{ color: "var(--color-text)" }} />
        </button>
        <h1 className="text-lg font-bold text-primary">Connect Your Telegram Channel</h1>
      </div>

      <div className="bg-card rounded-2xl border border-app shadow-app-sm p-4 flex flex-col gap-4">
        {STEPS.map((step, idx) => (
          <InstructionStep key={step.title} icon={step.icon} step={idx + 1} title={step.title} description={step.description} />
        ))}
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
                <div>
                  <p className="font-semibold text-primary text-xs">Waiting for channel selection…</p>
                  <p className="mt-0.5">This page updates automatically. Please wait.</p>
                </div>
              </div>
              <button onClick={reset} className="text-xs font-semibold text-secondary text-center">
                Cancel
              </button>
            </div>
          )}

          {state.phase === "unsupported" && (
            <div className="flex flex-col gap-3">
              <div className="flex items-start gap-2 text-left text-xs text-secondary bg-secondary rounded-xl p-3">
                <AlertTriangle size={14} className="mt-0.5 flex-shrink-0 text-brand" />
                <div>
                  <p className="font-semibold text-primary text-xs">Telegram Update Required</p>
                  <p className="mt-0.5">
                    Your Telegram app does not support direct channel selection yet. Please update Telegram to the
                    latest version and try again.
                  </p>
                </div>
              </div>
              <button onClick={reset} className="btn-primary w-full py-3.5 text-sm font-semibold">
                Try Again
              </button>
              <button onClick={onBack} className="text-xs font-semibold text-secondary text-center">
                Back to Channel Connect
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
