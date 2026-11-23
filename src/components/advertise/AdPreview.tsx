"use client";
import React from "react";
import { FileText, ListMusic, Megaphone, Send, MessageSquareText } from "lucide-react";
import type { AdType, ContentKind } from "@/lib/ads/constants";

/**
 * The sponsored card exactly as the SponsoredSlot renders it (same structure and wording). Text is rendered by React as
 * plain text — never as HTML. `thumbnailUrl` only ever comes from Onfile's own thumbnail storage.
 */
export default function AdPreview({
  adType,
  contentKind,
  headline,
  description,
  ctaText,
  thumbnailUrl,
  label,
}: {
  adType: AdType | null;
  contentKind: ContentKind | null;
  headline: string;
  description: string;
  ctaText: string;
  thumbnailUrl?: string | null;
  label?: string | null;
}) {
  const Icon = adType === "telegram_channel" ? Send : adType === "telegram_post" ? MessageSquareText : contentKind === "playlist" ? ListMusic : adType === "onfile_content" ? FileText : Megaphone;
  return (
    <div className="bg-card border border-app rounded-2xl p-3 shadow-app-sm min-w-0" data-testid="ad-preview">
      <p className="text-[10px] font-bold tracking-wide uppercase text-muted mb-2">Sponsored</p>
      <div className="flex gap-3 min-w-0">
        <div className="w-16 h-16 rounded-xl bg-brand-10 text-brand flex items-center justify-center flex-shrink-0 overflow-hidden border border-app">
          {thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumbnailUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
          ) : (
            <Icon size={24} aria-hidden={true} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-primary line-clamp-2 break-words">{headline || <span className="text-muted font-medium">Your headline</span>}</p>
          <p className="text-xs text-secondary line-clamp-2 break-words mt-0.5">{description || <span className="text-muted">Your short description appears here.</span>}</p>
          {label && <p className="text-[11px] text-muted mt-1 truncate">{label}</p>}
        </div>
      </div>
      <div className="mt-3 w-full rounded-xl bg-[#FF6115] text-white text-sm font-semibold py-2.5 text-center break-words" aria-hidden={true}>
        {ctaText || "Button"}
      </div>
    </div>
  );
}
