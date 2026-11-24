"use client";
import React from "react";
import { BarChart3, FileText, ListMusic, Megaphone, MessageSquareText, Pause, Pencil, Play, Send } from "lucide-react";
import type { PublicCampaign } from "@/lib/ads/serialize";
import { AD_TYPE_INFO, OBJECTIVE_INFO, type AdType } from "@/lib/ads/constants";
import StatusBadge from "./StatusBadge";
import { formatCount, formatDay, formatMoney } from "./format";

export function CampaignIcon({ c, size = 22 }: { c: Pick<PublicCampaign, "adType" | "contentKind">; size?: number }) {
  const Icon = c.adType === "telegram_channel" ? Send : c.adType === "telegram_post" ? MessageSquareText : c.contentKind === "playlist" ? ListMusic : c.adType === "onfile_content" ? FileText : Megaphone;
  return <Icon size={size} aria-hidden={true} />;
}

export function CampaignThumb({ c }: { c: PublicCampaign }) {
  return (
    <span className="w-12 h-12 rounded-xl bg-brand-10 text-brand flex items-center justify-center flex-shrink-0 overflow-hidden border border-app">
      {c.thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={c.thumbnailUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
      ) : (
        <CampaignIcon c={c} />
      )}
    </span>
  );
}

export function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-muted truncate">{label}</p>
      <p className="text-sm font-bold text-primary truncate" title={typeof value === "string" ? value : undefined}>{value}</p>
      {sub && <p className="text-[11px] text-muted truncate">{sub}</p>}
    </div>
  );
}

export function ProgressBar({ percent, label }: { percent: number; label: string }) {
  return (
    <div role="progressbar" aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100} aria-label={label} className="h-2 w-full rounded-full bg-secondary overflow-hidden">
      <div className="h-full rounded-full bg-[#FF6115] transition-all" style={{ width: `${Math.max(2, percent)}%` }} />
    </div>
  );
}

export default function CampaignCard({
  c,
  onOpen,
  onPerformance,
  onEdit,
  onPause,
  onResume,
}: {
  c: PublicCampaign;
  onOpen: () => void;
  onPerformance: () => void;
  onEdit: () => void;
  onPause: () => void;
  onResume: () => void;
}) {
  const showJoins = c.objective === "verified_joins";
  const cap = c.capabilities;
  return (
    <article className="bg-card border border-app rounded-2xl p-3.5 shadow-app-sm min-w-0" data-testid="campaign-card" data-ref={c.ref}>
      <div className="flex items-start gap-3 min-w-0">
        <CampaignThumb c={c} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-sm font-bold text-primary line-clamp-2 break-words min-w-0">{c.title || c.headline || "Untitled campaign"}</h3>
            <StatusBadge status={c.status} />
          </div>
          <p className="text-xs text-secondary mt-0.5 truncate">
            {AD_TYPE_INFO[c.adType as AdType]?.label ?? c.adType} · {c.objective ? OBJECTIVE_INFO[c.objective].label : "No objective yet"}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-x-3 gap-y-2.5 mt-3">
        <Stat label="Budget" value={formatMoney(c.budget, c.currency)} />
        <Stat label="Spent" value={formatMoney(c.spent, c.currency)} />
        <Stat label="Impressions" value={formatCount(c.impressions)} />
        <Stat label="Clicks" value={formatCount(c.clicks)} />
        {showJoins ? <Stat label="Verified joins" value={formatCount(c.verifiedJoins)} /> : <Stat label="Starts" value={formatDay(c.startDate)} />}
        {showJoins ? <Stat label="Starts" value={formatDay(c.startDate)} /> : <Stat label="Ends" value={formatDay(c.endDate)} />}
        {showJoins && <Stat label="Ends" value={formatDay(c.endDate)} />}
      </div>

      {c.progress && c.objective && (
        <div className="mt-3">
          <div className="flex justify-between text-[11px] text-secondary mb-1">
            <span>Target: {formatCount(c.progress.current)} / {formatCount(c.progress.target)} {OBJECTIVE_INFO[c.objective].unit}</span>
            <span>{c.progress.percent}%</span>
          </div>
          <ProgressBar percent={c.progress.percent} label="Progress toward target" />
        </div>
      )}

      <div className="flex flex-wrap gap-2 mt-3.5">
        <button type="button" onClick={onOpen} className="btn-secondary min-h-10 px-3.5 text-xs">View details</button>
        {cap.edit && (
          <button type="button" onClick={onEdit} className="btn-secondary min-h-10 px-3.5 text-xs inline-flex items-center gap-1.5"><Pencil size={13} aria-hidden={true} /> Edit draft</button>
        )}
        {cap.pause && (
          <button type="button" onClick={onPause} className="btn-secondary min-h-10 px-3.5 text-xs inline-flex items-center gap-1.5"><Pause size={13} aria-hidden={true} /> Pause</button>
        )}
        {cap.resume && (
          <button type="button" onClick={onResume} className="btn-secondary min-h-10 px-3.5 text-xs inline-flex items-center gap-1.5"><Play size={13} aria-hidden={true} /> Resume</button>
        )}
        {cap.viewPerformance && (
          <button type="button" onClick={onPerformance} className="btn-secondary min-h-10 px-3.5 text-xs inline-flex items-center gap-1.5"><BarChart3 size={13} aria-hidden={true} /> Performance</button>
        )}
      </div>
      {c.status === "paused" && c.pausedBy === "admin" && <p className="text-[11px] text-muted mt-2">Paused by Onfile — only an administrator can resume it.</p>}
    </article>
  );
}
