"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, FileText, Loader2, Megaphone, Send, MessageSquareText } from "lucide-react";
import type { SlotKey } from "@/lib/ads/constants";
import { getTelegramWebApp } from "@/lib/telegramWebApp";

interface ServedAd {
  token: string;
  adType: string | null;
  objective: string | null;
  headline: string;
  description: string;
  ctaText: string;
  thumbnailUrl: string | null;
  channelTitle: string | null;
  joinFlow: boolean;
}

type JoinUi = "idle" | "starting" | "already_member" | "awaiting_join" | "checking" | "verified" | "error";

/** Only ever navigate to an Onfile page or an https Telegram link (the server already validates; this is a second gate). */
function safeNavigate(url: string) {
  if (/^\/(f|p)\/[A-Za-z0-9_-]{1,64}$/.test(url)) {
    window.location.assign(url);
    return;
  }
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return;
  }
  if (u.protocol !== "https:" || (u.hostname !== "t.me" && u.hostname !== "telegram.me")) return;
  const tg = getTelegramWebApp();
  if (tg && typeof tg.openTelegramLink === "function") tg.openTelegramLink(u.toString());
  else window.open(u.toString(), "_blank", "noopener,noreferrer");
}

/**
 * A sponsored card for one surface. Renders NOTHING while loading, when there is no eligible campaign, or on any error
 * (an ad slot must never break or delay the page it sits on). Impressions are reported once the card is on screen;
 * clicks and joins go through the server, which records them, dedupes them and validates the destination.
 */
export default function SponsoredSlot({ slot, className, asListItem }: { slot: SlotKey; className?: string; asListItem?: boolean }) {
  const [ad, setAd] = useState<ServedAd | null>(null);
  const [join, setJoin] = useState<JoinUi>("idle");
  const [joinMsg, setJoinMsg] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const reported = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/ads/serve?slot=${slot}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { ad: ServedAd | null };
        if (!cancelled && data.ad) setAd(data.ad);
      } catch {
        /* no ad */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slot]);

  const post = useCallback(async (url: string, body: unknown) => {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { ok: res.ok, status: res.status, data: (await res.json().catch(() => ({}))) as Record<string, unknown> };
  }, []);

  // Report ONE impression when at least half of the card is visible (or immediately where IntersectionObserver is unavailable).
  useEffect(() => {
    if (!ad || reported.current || !ref.current) return;
    const send = () => {
      if (reported.current) return;
      reported.current = true;
      void post("/api/ads/event", { token: ad.token, type: "impression" }).catch(() => {});
    };
    if (typeof IntersectionObserver === "undefined") {
      send();
      return;
    }
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting && e.intersectionRatio >= 0.5) && (send(), io.disconnect()), { threshold: [0.5] });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [ad, post]);

  if (!ad) return null;
  const Wrapper = (asListItem ? "li" : "div") as "div";

  const openDestination = async () => {
    try {
      const r = await post("/api/ads/event", { token: ad.token, type: "click" });
      const url = typeof r.data.url === "string" ? r.data.url : null;
      if (url) safeNavigate(url);
    } catch {
      /* ignore */
    }
  };

  const onJoin = async () => {
    setJoinMsg(null);
    setJoin("starting");
    try {
      const r = await post("/api/ads/join", { token: ad.token, action: "start" });
      if (!r.ok) {
        setJoin("error");
        setJoinMsg(typeof r.data.error === "string" ? r.data.error : "Couldn't check your membership.");
        return;
      }
      const state = r.data.state as string;
      if (state === "already_member") {
        setJoin("already_member");
        return;
      }
      if (state === "verified") {
        setJoin("verified");
        return;
      }
      setJoin("awaiting_join");
      await openDestination();
    } catch {
      setJoin("error");
      setJoinMsg("Network error. Please try again.");
    }
  };

  const onVerify = async () => {
    setJoinMsg(null);
    setJoin("checking");
    try {
      const r = await post("/api/ads/join", { token: ad.token, action: "verify" });
      if (!r.ok) {
        setJoin("awaiting_join");
        setJoinMsg(typeof r.data.error === "string" ? r.data.error : "Couldn't verify right now.");
        return;
      }
      const state = r.data.state as string;
      if (state === "verified") setJoin("verified");
      else if (state === "already_member") setJoin("already_member");
      else {
        setJoin("awaiting_join");
        setJoinMsg("We don't see you in the channel yet. Join it, then tap verify again.");
      }
    } catch {
      setJoin("awaiting_join");
      setJoinMsg("Network error. Please try again.");
    }
  };

  const Icon = ad.adType === "telegram_channel" ? Send : ad.adType === "telegram_post" ? MessageSquareText : ad.adType === "onfile_content" ? FileText : Megaphone;

  return (
    <Wrapper ref={ref as React.Ref<HTMLDivElement & HTMLLIElement>} className={className} data-testid="sponsored-slot" data-slot={slot}>
      <aside aria-label="Sponsored" className="bg-card border border-app rounded-2xl p-3 shadow-app-sm min-w-0">
        <p className="text-[10px] font-bold tracking-wide uppercase text-muted mb-2">Sponsored</p>
        <div className="flex gap-3 min-w-0">
          <div className="w-14 h-14 rounded-xl bg-brand-10 text-brand flex items-center justify-center flex-shrink-0 overflow-hidden border border-app">
            {ad.thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={ad.thumbnailUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
            ) : (
              <Icon size={22} aria-hidden={true} />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-primary line-clamp-2 break-words">{ad.headline}</p>
            {ad.description && <p className="text-xs text-secondary line-clamp-2 break-words mt-0.5">{ad.description}</p>}
          </div>
        </div>

        {!ad.joinFlow || join === "idle" || join === "error" || join === "starting" ? (
          <button
            type="button"
            onClick={ad.joinFlow ? () => void onJoin() : () => void openDestination()}
            disabled={join === "starting"}
            className="mt-3 w-full min-h-11 rounded-xl bg-[#FF6115] text-white text-sm font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-70"
          >
            {join === "starting" && <Loader2 size={15} className="animate-spin" aria-hidden={true} />}
            {ad.ctaText}
          </button>
        ) : null}

        {ad.joinFlow && join === "awaiting_join" && (
          <div className="mt-3 flex flex-col gap-2">
            <button type="button" onClick={() => void onVerify()} className="w-full min-h-11 rounded-xl bg-[#FF6115] text-white text-sm font-semibold">I&apos;ve joined — verify</button>
            <button type="button" onClick={() => void openDestination()} className="text-xs font-semibold text-brand min-h-9">Open channel again</button>
          </div>
        )}
        {ad.joinFlow && join === "checking" && (
          <p className="mt-3 text-sm text-secondary inline-flex items-center gap-2"><Loader2 size={15} className="animate-spin" aria-hidden={true} /> Checking with Telegram…</p>
        )}
        {ad.joinFlow && join === "verified" && (
          <p className="mt-3 text-sm font-semibold inline-flex items-center gap-2 text-green-600"><CheckCircle2 size={16} aria-hidden={true} /> Membership verified — thanks for joining!</p>
        )}
        {ad.joinFlow && join === "already_member" && (
          <p className="mt-3 text-sm text-secondary inline-flex items-center gap-2"><CheckCircle2 size={16} aria-hidden={true} /> You&apos;re already a member of this channel.</p>
        )}
        {joinMsg && <p role="alert" className="mt-2 text-xs text-red-500 break-words">{joinMsg}</p>}
      </aside>
    </Wrapper>
  );
}
