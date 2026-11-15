"use client";
import React from "react";
import {
  MousePointerClick,
  RefreshCw,
  ShieldCheck,
  UserCog,
  XCircle,
} from "lucide-react";
import BotFallbackPanel, { BotConnectFailure, isBotFallbackPhase } from "@/components/setup/BotFallbackPanel";
import { isRunningInsideTelegram } from "@/lib/telegramWebApp";
import { useTelegramBackButton } from "@/lib/useTelegramBackButton";
import { useChannelConnect, type ConnectedChannel } from "@/lib/useChannelConnect";

interface InstructionStepData {
  icon: React.FC<{ size: number; className?: string }>;
  title: string;
  description: string;
}

/**
 * The five instruction steps of "Connect channel via bot". Kept exactly as they
 * were; the action area below them is now the bot-guided flow
 * (Connect → Onfile Bot chat → Return to Onfile — see
 * docs/BOT_GUIDED_CONNECT.md).
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
  const { state, check, connect, refresh, reset } = useChannelConnect(onSuccess);

  // Telegram's native Back Button is the only back control: it returns to the Channel Connect screen.
  useTelegramBackButton(onBack);

  const insideTelegram = isRunningInsideTelegram();

  return (
    <div className="flex flex-col gap-5 w-full max-w-sm">
      <h1 className="text-lg font-bold text-primary">Connect Your Telegram Channel</h1>

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
          {isBotFallbackPhase(state) && (
            <BotFallbackPanel
              state={state}
              check={check}
              onConnect={connect}
              onRefresh={refresh}
              onCancel={reset}
            />
          )}

          {state.phase === "failed" && <BotConnectFailure message={state.message} onRetry={connect} />}
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
