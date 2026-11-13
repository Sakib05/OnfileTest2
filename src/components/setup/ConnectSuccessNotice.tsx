"use client";
import React from "react";
import { CheckCircle2 } from "lucide-react";
import type { ConnectedChannel } from "@/lib/useChannelConnect";

/** The congratulatory sentence shown for EVERY successful connection method. */
export const CONNECT_SUCCESS_MESSAGE = "🎉 Congratulations! Your channel is now connected to your Onfile account.";

/**
 * Inline success confirmation for Channel Management's Direct Picker flow
 * (the Bot Fallback additionally confirms inside the bot chat; the onboarding
 * flow uses ChannelConnectSuccessScreen, which carries the same sentence).
 * Rendered ONLY once the server has verified the connection — callers pass a
 * channel that came back from /api/channels/connect-status as "verified".
 * The channel name is rendered as plain text (React-escaped).
 */
export default function ConnectSuccessNotice({ channel }: { channel: ConnectedChannel }) {
  const name = channel.channelName || (channel.channelUsername ? `@${channel.channelUsername}` : null);
  return (
    <div
      className="flex flex-col items-center gap-2 text-center bg-secondary rounded-xl p-4"
      data-testid="connect-success"
      role="status"
    >
      <CheckCircle2 size={28} className="text-green-500" />
      <p className="text-sm font-semibold text-primary">{CONNECT_SUCCESS_MESSAGE}</p>
      {name && <p className="text-xs text-secondary break-words max-w-full">“{name}”</p>}
    </div>
  );
}
