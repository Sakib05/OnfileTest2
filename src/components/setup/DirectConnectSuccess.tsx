"use client";
import React, { useEffect, useRef } from "react";
import { CheckCircle2, MessageCircle, ShieldCheck } from "lucide-react";
import type { ConnectedChannel } from "@/lib/useChannelConnect";

/** How long the Congratulations message stays readable before the Dashboard opens by itself. */
export const DIRECT_SUCCESS_AUTO_NAVIGATE_MS = 2500;

export const DIRECT_CONNECT_SUCCESS_COPY = {
  title: "🎉 Congratulations!",
  headline: "Your Telegram channel has been successfully connected to Onfile.",
  body: "Your channel is now ready. You can manage your content and start using Onfile.",
} as const;

/**
 * In-app success state of the DIRECT (Telegram `requestChat`) connection flow. Rendered ONLY once the backend has
 * confirmed the connection (`/api/channels/connect-status` → "verified"; nothing the picker or the client reports
 * can reach this component). It is never sent to the bot chat.
 *
 * After a short moment it calls `onDone` exactly once, which navigates to the Dashboard and refreshes its data.
 * The channel name is rendered as plain text (React-escaped).
 */
export default function DirectConnectSuccess({
  channel,
  onDone,
  autoNavigateMs = DIRECT_SUCCESS_AUTO_NAVIGATE_MS,
}: {
  channel: ConnectedChannel;
  onDone: () => void;
  autoNavigateMs?: number;
}) {
  const done = useRef(false);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  });

  const finish = React.useCallback(() => {
    if (done.current) return; // timer + tap can never navigate twice
    done.current = true;
    onDoneRef.current();
  }, []);

  useEffect(() => {
    const id = setTimeout(finish, autoNavigateMs);
    return () => clearTimeout(id);
  }, [finish, autoNavigateMs]);

  const channelLabel = channel.channelName || (channel.channelUsername ? `@${channel.channelUsername}` : `Channel #${channel.id}`);

  return (
    <div
      className="flex flex-col items-center gap-6 w-full max-w-sm text-center animate-scale-in"
      role="status"
      data-testid="direct-connect-success"
    >
      <div className="w-20 h-20 rounded-3xl gradient-brand flex items-center justify-center shadow-lg">
        <CheckCircle2 size={40} color="white" />
      </div>

      <div>
        <h1 className="text-xl font-bold text-primary" data-testid="direct-success-title">{DIRECT_CONNECT_SUCCESS_COPY.title}</h1>
        <p className="text-sm text-primary font-medium mt-2" data-testid="direct-success-headline">{DIRECT_CONNECT_SUCCESS_COPY.headline}</p>
        <p className="text-sm text-secondary mt-2" data-testid="direct-success-body">{DIRECT_CONNECT_SUCCESS_COPY.body}</p>
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

      <button onClick={finish} className="btn-primary w-full py-3.5 text-sm font-semibold" data-testid="direct-success-continue">
        Open Dashboard
      </button>
    </div>
  );
}
