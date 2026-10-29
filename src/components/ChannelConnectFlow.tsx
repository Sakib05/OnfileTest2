"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, MessageCircle, Radio, ShieldCheck, XCircle } from "lucide-react";
import { isRunningInsideTelegram, openBotChat } from "@/lib/telegramWebApp";

export interface ConnectedChannel {
  id: number;
  channelName: string | null;
  channelUsername: string | null;
  status: "pending" | "verified" | "failed" | "disconnected";
  telegramChannelId: string | null;
}

type FlowState =
  | { phase: "idle" }
  | { phase: "starting" }
  | { phase: "waiting"; botUsername: string; token: string }
  | { phase: "needs_bot_chat"; botUsername: string }
  | { phase: "verified"; channel: ConnectedChannel }
  | { phase: "failed"; message: string };

const POLL_INTERVAL_MS = 2500;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * The two-step native Telegram channel connection experience:
 *   1. Select Chat  — Telegram's own chat picker (request_chat keyboard
 *      button), filtered to channels the user administers.
 *   2. Add Bot       — Telegram's own "add as administrator" screen, shown
 *      automatically by Telegram when the bot isn't already an admin with
 *      the requested rights.
 * Neither screen is rendered by Onfile; this component only kicks the flow
 * off and polls for the backend's independently verified result.
 */
export default function ChannelConnectFlow({
  onConnected,
}: {
  onConnected?: (channel: ConnectedChannel) => void;
}) {
  const [state, setState] = useState<FlowState>({ phase: "idle" });
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollDeadline = useRef<number>(0);

  const stopPolling = useCallback(() => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  const pollOnce = useCallback(
    async (token: string) => {
      try {
        const res = await fetch(`/api/channels/connect-status?token=${encodeURIComponent(token)}`);
        const data = await res.json().catch(() => ({}));
        if (data.status === "verified") {
          stopPolling();
          setState({ phase: "verified", channel: data.channel });
          onConnected?.(data.channel);
        } else if (data.status === "failed") {
          stopPolling();
          setState({ phase: "failed", message: data.error || "Channel verification failed." });
        } else if (data.status === "expired") {
          stopPolling();
          setState({ phase: "failed", message: "This connection request expired. Please try again." });
        } else if (Date.now() > pollDeadline.current) {
          stopPolling();
          setState({ phase: "failed", message: "We didn't detect a channel selection in time. Please try again." });
        }
      } catch {
        // Transient network errors during polling are not fatal; keep trying
        // until the deadline.
        if (Date.now() > pollDeadline.current) {
          stopPolling();
          setState({ phase: "failed", message: "Network error while checking connection status." });
        }
      }
    },
    [onConnected, stopPolling]
  );

  const startPolling = useCallback(
    (token: string) => {
      pollDeadline.current = Date.now() + POLL_TIMEOUT_MS;
      stopPolling();
      pollTimer.current = setInterval(() => pollOnce(token), POLL_INTERVAL_MS);
      // Also re-check immediately whenever the Mini App regains focus
      // (the user just came back from Telegram's native screens).
      const onVisible = () => {
        if (document.visibilityState === "visible") pollOnce(token);
      };
      document.addEventListener("visibilitychange", onVisible);
      return () => document.removeEventListener("visibilitychange", onVisible);
    },
    [pollOnce, stopPolling]
  );

  const handleConnect = async () => {
    setState({ phase: "starting" });
    try {
      const res = await fetch("/api/channels/connect-request", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.reason === "cannot_message_user" && data.botUsername) {
          setState({ phase: "needs_bot_chat", botUsername: data.botUsername });
          return;
        }
        setState({ phase: "failed", message: data.error || "Could not start the connection flow." });
        return;
      }
      setState({ phase: "waiting", botUsername: data.botUsername, token: data.token });
      startPolling(data.token);
      openBotChat(data.botUsername);
    } catch {
      setState({ phase: "failed", message: "Network error. Please try again." });
    }
  };

  const handleOpenBotChat = (botUsername: string) => {
    openBotChat(botUsername);
  };

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
        <button onClick={handleConnect} className="btn-primary w-full py-3 text-sm flex items-center justify-center gap-2">
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
              We opened your chat with the Onfile bot. Tap <strong>&ldquo;Select channel to connect&rdquo;</strong>, choose your channel, and
              confirm adding the bot as an administrator if asked. This screen updates automatically once Telegram confirms it.
            </span>
          </div>
          <button onClick={() => handleOpenBotChat(state.botUsername)} className="btn-secondary w-full py-2.5 text-sm">
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
          <button onClick={() => handleOpenBotChat(state.botUsername)} className="btn-primary w-full py-3 text-sm">
            Open Onfile Bot Chat
          </button>
          <button onClick={() => setState({ phase: "idle" })} className="btn-secondary w-full py-2.5 text-sm">
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
          <button onClick={() => setState({ phase: "idle" })} className="btn-primary w-full py-3 text-sm">
            Try Again
          </button>
        </div>
      )}

      <div className="flex items-start gap-2 text-left text-[11px] text-muted">
        <ShieldCheck size={13} className="mt-0.5 flex-shrink-0" />
        <span>Onfile only requests permission for the bot to post messages in your channel — nothing more.</span>
      </div>
    </div>
  );
}

function StepPill({ active, label }: { active: boolean; label: string }) {
  return (
    <span className={active ? "chip bg-brand-10 text-brand" : "chip bg-secondary text-secondary"}>{label}</span>
  );
}
