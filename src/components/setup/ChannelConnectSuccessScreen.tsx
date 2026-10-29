"use client";
import React from "react";
import { CheckCircle2, MessageCircle, ShieldCheck } from "lucide-react";
import type { ConnectedChannel } from "@/lib/useChannelConnect";

/**
 * Shown ONLY after the backend has independently confirmed: the channel
 * resolves on Telegram, it is private, the bot has the required admin
 * access, the authenticated user administers it, and the connection has
 * been persisted (see src/lib/channelConnection.ts /
 * finalizeVerifiedChannelConnection — the single place a channel row is
 * ever written). Nothing here is simulated or assumed.
 */
export default function ChannelConnectSuccessScreen({
  channel,
  onContinue,
}: {
  channel: ConnectedChannel;
  onContinue: () => void;
}) {
  const channelLabel = channel.channelName || (channel.channelUsername ? `@${channel.channelUsername}` : `Channel #${channel.id}`);

  return (
    <div className="flex flex-col items-center gap-6 w-full max-w-sm text-center animate-scale-in">
      <div className="w-20 h-20 rounded-3xl gradient-brand flex items-center justify-center shadow-lg">
        <CheckCircle2 size={40} color="white" />
      </div>

      <div>
        <h1 className="text-xl font-bold text-primary">Channel Connected Successfully!</h1>
        <p className="text-sm text-secondary mt-2">Your private Telegram channel is connected to Onfile.</p>
      </div>

      <div className="bg-card rounded-2xl border border-app shadow-app-sm p-4 w-full flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl gradient-brand flex items-center justify-center flex-shrink-0">
          <MessageCircle size={18} color="white" />
        </div>
        <div className="flex-1 min-w-0 text-left">
          <p className="text-sm font-semibold text-primary truncate">{channelLabel}</p>
          <span className="text-xs flex items-center gap-1 text-green-600 dark:text-green-400">
            <ShieldCheck size={11} />
            Verified &amp; connected
          </span>
        </div>
      </div>

      <button onClick={onContinue} className="btn-primary w-full py-3.5 text-sm font-semibold">
        Continue to Onfile
      </button>
    </div>
  );
}
