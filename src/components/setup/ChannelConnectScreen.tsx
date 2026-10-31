"use client";
import React, { useState } from "react";
import { Bot, Link2, Loader2, ShieldAlert } from "lucide-react";
import type { ConnectedChannel } from "@/lib/useChannelConnect";

/** Loose client-side format check only — never treated as proof of anything.
 * The backend independently verifies the channel is private, resolves it on
 * Telegram, and confirms the bot's admin access before anything is
 * persisted (see src/lib/telegramBot.ts). */
function looksLikeChannelLink(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return /^(?:https?:\/\/)?t\.me\/[a-zA-Z0-9_]{5,32}\/?$/i.test(trimmed) || /^@?[a-zA-Z0-9_]{5,32}$/.test(trimmed);
}

export default function ChannelConnectScreen({
  onConnectViaBot,
  onManualConnected,
  onOpenGuide,
}: {
  onConnectViaBot: () => void;
  onManualConnected: (channel: ConnectedChannel) => void;
  onOpenGuide: (currentLink: string) => void;
}) {
  const [link, setLink] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return; // guard against duplicate submissions

    const trimmed = link.trim();
    if (!looksLikeChannelLink(trimmed)) {
      setError("Enter a valid private channel link, e.g. https://t.me/your_channel");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelIdentifier: trimmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "We couldn't verify that channel. Please try again.");
        return;
      }
      onManualConnected(data.channel);
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-5 w-full max-w-sm">
      <div className="text-center">
        <h1 className="text-xl font-bold text-primary">Connect Your Telegram Channel</h1>
      </div>

      <button
        type="button"
        onClick={onConnectViaBot}
        className="btn-primary w-full py-3.5 text-sm font-semibold flex items-center justify-center gap-2"
      >
        <Bot size={17} />
        Connect channel via bot
      </button>

      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-app" />
        <span className="text-xs font-semibold text-muted">OR</span>
        <div className="h-px flex-1 bg-app" />
      </div>

      <form onSubmit={handleManualSubmit} className="flex flex-col gap-3">
        <div>
          <label className="text-xs font-medium text-secondary mb-1.5 flex items-center gap-1.5">
            <Link2 size={12} className="text-brand" />
            Private channel link
          </label>
          <input
            className="input-app text-sm"
            placeholder="https://t.me/your_channel"
            value={link}
            onChange={(e) => {
              setLink(e.target.value);
              if (error) setError(null);
            }}
            disabled={submitting}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
        </div>

        {error && (
          <div className="flex items-start gap-2 text-left text-xs text-red-500 bg-red-50 dark:bg-red-900/20 rounded-xl p-3">
            <ShieldAlert size={14} className="mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={submitting || !link.trim()}
          className="btn-secondary w-full py-3 text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60"
        >
          {submitting && <Loader2 size={15} className="animate-spin" />}
          {submitting ? "Verifying..." : "Next"}
        </button>
      </form>

      <p className="text-xs text-secondary text-center pt-1">
        Need help?{" "}
        <button type="button" onClick={() => onOpenGuide(link)} className="underline font-semibold text-brand">
          View step-by-step guide
        </button>
      </p>
    </div>
  );
}
