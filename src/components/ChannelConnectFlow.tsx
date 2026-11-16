"use client";
import React, { useState } from "react";
import { Radio, ShieldCheck } from "lucide-react";
import BotFallbackPanel, { BotConnectFailure, isBotFallbackPhase } from "@/components/setup/BotFallbackPanel";
import ConnectSuccessNotice from "@/components/setup/ConnectSuccessNotice";
import DirectConnectSuccess from "@/components/setup/DirectConnectSuccess";
import { useApp } from "@/contexts/AppContext";
import { isRunningInsideTelegram } from "@/lib/telegramWebApp";
import { useChannelConnect, type ConnectedChannel } from "@/lib/useChannelConnect";

export type { ConnectedChannel } from "@/lib/useChannelConnect";

/**
 * Channel Management's "Connect New Channel" action: the same bot-guided flow as
 * the onboarding screen — "Connect" → Onfile Bot chat with Telegram's
 * native channel picker → "Return to Onfile" → automatic verification. Everything
 * is driven by the shared `useChannelConnect` engine; this component only renders
 * its state. Nothing here is trusted: success is shown only once the backend has
 * verified the connection.
 */
export default function ChannelConnectFlow({
  onConnected,
}: {
  onConnected?: (channel: ConnectedChannel) => void;
}) {
  const { refreshDashboard, setActiveTab, setProfileEntry } = useApp();
  // Direct Mini App flow (Telegram `requestChat`): the Congratulations state is shown in-app, then the Dashboard opens.
  const [directSuccess, setDirectSuccess] = useState<ConnectedChannel | null>(null);
  const { state, check, connect, refresh, reset } = useChannelConnect((channel, meta) => {
    if (meta?.direct) {
      setDirectSuccess(channel);
      return;
    }
    onConnected?.(channel);
  });

  const handleDirectSuccessDone = () => {
    setProfileEntry(null);
    setActiveTab("home"); // the Dashboard — not Channel Management
    void refreshDashboard();
  };

  if (!isRunningInsideTelegram()) {
    return (
      <div className="flex items-start gap-2 text-left text-xs text-secondary bg-secondary rounded-xl p-3">
        <Radio size={14} className="mt-0.5 flex-shrink-0 text-brand" />
        <span>Open Onfile from inside Telegram to connect a channel. This screen cannot access Telegram&apos;s native chat selector in a regular browser tab.</span>
      </div>
    );
  }

  if (directSuccess) {
    return (
      <div className="fixed inset-0 z-50 bg-app flex items-center justify-center px-6 py-10" data-testid="direct-success-overlay">
        <DirectConnectSuccess channel={directSuccess} onDone={handleDirectSuccessDone} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 w-full">
      {isBotFallbackPhase(state) && (
        <BotFallbackPanel state={state} check={check} onConnect={connect} onRefresh={refresh} onCancel={reset} />
      )}

      {state.phase === "verified" && <ConnectSuccessNotice channel={state.channel} />}

      {state.phase === "failed" && <BotConnectFailure message={state.message} onRetry={connect} />}

      <div className="flex items-start gap-2 text-left text-[11px] text-muted">
        <ShieldCheck size={13} className="mt-0.5 flex-shrink-0" />
        <span>Onfile only requests permission for the bot to post messages in your private channel — nothing more.</span>
      </div>
    </div>
  );
}
