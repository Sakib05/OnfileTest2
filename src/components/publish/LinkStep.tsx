"use client";
import React, { useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Link2, Loader2, ShieldCheck, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { parseTelegramPostLink, POST_LINK_FAILURE_MESSAGES } from "@/lib/telegramPostLink";
import { useApp } from "@/contexts/AppContext";
import type { PublishDraft, VerifiedLinkInfo } from "./draft";

type Status = "idle" | "verifying" | "error";

interface VerifyResponse {
  verified?: boolean;
  canonicalLink?: string;
  messageId?: number;
  channel?: { name: string | null; username: string | null };
  error?: string;
  reason?: string;
}

export default function LinkStep({
  draft,
  onChange,
  onContinue,
}: {
  draft: PublishDraft;
  onChange: (patch: Partial<PublishDraft>) => void;
  onContinue: () => void;
}) {
  const { refreshChannels } = useApp();
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<{ message: string; reason?: string } | null>(null);
  const requestSeq = useRef(0);

  const trimmed = draft.link.trim();
  const verified = draft.verified && draft.verified.forLink === trimmed ? draft.verified : null;

  const setLink = (value: string) => {
    requestSeq.current++; // invalidate any in-flight verification for the old value
    setStatus("idle");
    setError(null);
    onChange({ link: value, verified: null });
  };

  const verify = async () => {
    // Fast client-side format check (UX only — the server re-validates).
    const parsed = parseTelegramPostLink(trimmed);
    if (!parsed.ok) {
      setStatus("error");
      setError({ message: POST_LINK_FAILURE_MESSAGES[parsed.reason], reason: parsed.reason });
      return;
    }

    const seq = ++requestSeq.current;
    setStatus("verifying");
    setError(null);
    try {
      const res = await fetch("/api/publish/verify-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ link: trimmed }),
      });
      let data: VerifyResponse = {};
      try {
        data = (await res.json()) as VerifyResponse;
      } catch {
        /* non-JSON error body */
      }
      if (seq !== requestSeq.current) return; // input changed while waiting

      if (res.ok && data.verified && data.canonicalLink && typeof data.messageId === "number") {
        const info: VerifiedLinkInfo = {
          forLink: trimmed,
          canonicalLink: data.canonicalLink,
          messageId: data.messageId,
          channelName: data.channel?.name ?? null,
          channelUsername: data.channel?.username ?? null,
        };
        onChange({ verified: info });
        setStatus("idle");
        return;
      }

      if (res.status === 401) {
        setError({ message: "Your session has expired. Please reopen Onfile from Telegram and try again.", reason: "unauthorized" });
      } else if (data.reason === "channel_required") {
        setError({ message: data.error ?? "Connect your Telegram channel before publishing.", reason: "channel_required" });
        // Hands control to the existing channel-connection flow (page.tsx renders it when no channel exists).
        void refreshChannels();
      } else if (res.status === 429) {
        setError({ message: data.error ?? "Too many attempts. Please wait a moment.", reason: "rate_limited" });
      } else {
        setError({
          message: data.error ?? "We couldn't verify this link. Please try again.",
          reason: data.reason ?? "unknown",
        });
      }
      setStatus("error");
    } catch {
      if (seq !== requestSeq.current) return;
      setError({ message: "Network problem. Check your connection and try again.", reason: "network" });
      setStatus("error");
    }
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (status === "verifying") return;
    if (verified) onContinue();
    else void verify();
  };

  const verifying = status === "verifying";
  const mismatch = error?.reason === "channel_mismatch";

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
      <div className="flex flex-col items-center text-center gap-3 pt-2">
        <div
          className="w-14 h-14 rounded-2xl gradient-brand flex items-center justify-center"
          style={{ boxShadow: "0 8px 24px rgba(255,97,21,0.35)" }}
        >
          <Link2 size={26} color="white" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-primary leading-tight">Add Your Telegram Post</h2>
          <p className="text-sm text-secondary mt-1.5 max-w-xs mx-auto">
            Paste a link to a post from your connected Telegram channel.
          </p>
        </div>
      </div>

      <div className="bg-card rounded-2xl border border-app shadow-app-sm p-4 flex flex-col gap-3">
        <label htmlFor="post-link" className="text-xs font-semibold text-secondary">
          Telegram post link
        </label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              id="post-link"
              type="url"
              inputMode="url"
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              className={cn(
                "input-app text-sm pr-10 min-h-12",
                status === "error" && "!border-red-500",
                verified && "!border-green-500"
              )}
              placeholder="https://t.me/c/1234567890/125"
              value={draft.link}
              onChange={(e) => setLink(e.target.value)}
              disabled={verifying}
              aria-invalid={status === "error"}
              aria-describedby="post-link-feedback"
            />
            {draft.link && !verifying && (
              <button
                type="button"
                onClick={() => setLink("")}
                aria-label="Clear link"
                className="absolute right-1 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center text-muted"
              >
                <X size={16} />
              </button>
            )}
          </div>
        </div>

        <div id="post-link-feedback" aria-live="polite" className="flex flex-col gap-2">
          {status === "error" && error && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-xl p-3 bg-red-500/10 border border-red-500/30 animate-fade-in"
            >
              <AlertCircle size={16} className="text-red-500 mt-0.5 flex-shrink-0" />
              <div className="text-sm">
                <p className="text-red-600 dark:text-red-400 font-medium">{error.message}</p>
                {mismatch && (
                  <p className="text-xs text-secondary mt-1">
                    Open a post in the channel you connected to Onfile, tap Copy Link, and paste it here.
                  </p>
                )}
                {error.reason === "verification_unavailable" && (
                  <p className="text-xs text-secondary mt-1">Nothing was accepted. Please try again.</p>
                )}
                {error.reason === "channel_required" && (
                  <p className="text-xs text-secondary mt-1">Taking you to channel setup…</p>
                )}
              </div>
            </div>
          )}

          {verified && (
            <div className="flex items-start gap-2.5 rounded-xl p-3 bg-green-500/10 border border-green-500/30 animate-scale-in">
              <CheckCircle2 size={18} className="text-green-500 mt-0.5 flex-shrink-0" />
              <div className="text-sm min-w-0">
                <p className="text-green-700 dark:text-green-400 font-semibold">Connected Channel Verified</p>
                <p className="text-primary mt-0.5 truncate">
                  {verified.channelName ?? "Your connected channel"}
                  {verified.channelUsername ? ` · @${verified.channelUsername}` : ""}
                </p>
                <p className="text-xs text-secondary mt-1">
                  Post #{verified.messageId}. We confirmed the channel matches. The post itself is checked when the
                  file is delivered.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      <button
        type="submit"
        disabled={verifying || !trimmed}
        className="btn-primary min-h-12 py-3.5 text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {verifying ? (
          <>
            <Loader2 size={16} className="animate-spin" />
            Verifying with your channel…
          </>
        ) : verified ? (
          "Continue"
        ) : (
          <>
            <ShieldCheck size={16} />
            Verify &amp; Continue
          </>
        )}
      </button>

      <p className="text-xs text-secondary text-center flex items-center justify-center gap-1.5">
        <ShieldCheck size={12} className="text-brand" />
        Your file stays in your private Telegram channel.
      </p>
    </form>
  );
}
