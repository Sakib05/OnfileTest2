"use client";
import React from "react";
import { CheckCircle2, Send } from "lucide-react";
import { safeExternalLink } from "@/lib/download";

/** Shown only after the server approved the unlock. */
export default function SuccessPanel({ telegramMessageLink }: { telegramMessageLink: string | null }) {
  const href = safeExternalLink(telegramMessageLink);
  return (
    <section aria-label="File ready" className="rounded-3xl border border-app bg-card p-4 sm:p-5 flex flex-col gap-4 shadow-app-sm animate-scale-in" role="status">
      <div className="flex items-center gap-3">
        <span className="w-11 h-11 rounded-2xl bg-green-100 dark:bg-green-900/30 flex items-center justify-center flex-shrink-0">
          <CheckCircle2 size={22} className="text-green-500" />
        </span>
        <div className="min-w-0">
          <p className="font-bold text-primary">Your file is ready</p>
          <p className="text-xs text-secondary mt-0.5">{href ? "Open it in Telegram to receive the file." : "Access confirmed."}</p>
        </div>
      </div>
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" className="btn-cta">
          <Send size={18} />
          Open in Telegram
        </a>
      ) : (
        <p className="p-3 rounded-xl bg-secondary text-sm text-secondary text-center">The file will be sent to you via the Onfile Telegram bot shortly.</p>
      )}
    </section>
  );
}
