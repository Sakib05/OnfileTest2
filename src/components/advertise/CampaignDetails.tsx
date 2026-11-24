"use client";
import React, { useEffect, useRef } from "react";
import { AlertTriangle, Clock, Pause, Pencil, Play, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import type { PublicCampaign } from "@/lib/ads/serialize";
import {
  AD_TYPE_INFO,
  COMPLETION_REASON_LABELS,
  OBJECTIVE_INFO,
  PLACEMENTS,
  PRICING_MODEL_LABELS,
  PRICING_NOTICE,
  type AdType,
  type CompletionReason,
} from "@/lib/ads/constants";
import AdPreview from "./AdPreview";
import StatusBadge from "./StatusBadge";
import { ProgressBar, Stat } from "./CampaignCard";
import { formatCount, formatDay, formatMoney, formatPercent } from "./format";

export interface AnalyticsData {
  hasData: boolean;
  daily: { date: string; impressions: number; clicks: number }[];
  byPlacement: { placement: string; impressions: number; clicks: number }[];
}

function Card({ title, children, id }: { title: string; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="bg-card border border-app rounded-2xl p-3.5 min-w-0">
      <h2 className="text-sm font-bold text-primary mb-2.5">{title}</h2>
      {children}
    </section>
  );
}

function Banner({ tone, title, children }: { tone: "pending" | "rejected" | "processing" | "completed"; title: string; children?: React.ReactNode }) {
  return (
    <div className={`status-${tone} rounded-2xl p-3.5 text-sm break-words`} role="status">
      <p className="font-bold">{title}</p>
      {children && <div className="text-xs mt-1 leading-relaxed">{children}</div>}
    </div>
  );
}

export default function CampaignDetails({
  campaign: c,
  analytics,
  loading,
  error,
  focusPerformance,
  onRetry,
  onEdit,
  onPause,
  onResume,
  onReopen,
  onDelete,
}: {
  campaign: PublicCampaign | null;
  analytics: AnalyticsData | null;
  loading: boolean;
  error: string | null;
  focusPerformance: boolean;
  onRetry: () => void;
  onEdit: () => void;
  onPause: () => void;
  onResume: () => void;
  onReopen: () => void;
  onDelete: () => void;
}) {
  const perfRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusPerformance && c && analytics) perfRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [focusPerformance, c, analytics]);

  if (error && !c) {
    return (
      <div className="bg-card border border-app rounded-2xl p-6 text-center flex flex-col items-center gap-3">
        <AlertTriangle size={28} className="text-muted" aria-hidden={true} />
        <p className="text-sm text-secondary">{error}</p>
        <button type="button" onClick={onRetry} className="btn-primary min-h-11 px-6 text-sm inline-flex items-center gap-2"><RefreshCw size={15} aria-hidden={true} /> Try again</button>
      </div>
    );
  }
  if (loading || !c) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading campaign">
        {[0, 1, 2].map((i) => <div key={i} className="h-32 rounded-2xl bg-secondary animate-pulse-brand" />)}
      </div>
    );
  }

  const cap = c.capabilities;
  const objective = c.objective ? OBJECTIVE_INFO[c.objective] : null;
  const maxDaily = Math.max(1, ...(analytics?.daily ?? []).map((d) => Math.max(d.impressions, d.clicks)));

  return (
    <div className="flex flex-col gap-3.5 animate-fade-in min-w-0">
      <header className="min-w-0">
        <div className="flex items-start justify-between gap-2">
          <h1 className="text-lg font-bold text-primary break-words min-w-0">{c.title || c.headline || "Untitled campaign"}</h1>
          <StatusBadge status={c.status} />
        </div>
        <p className="text-xs text-muted mt-1">Reference <span className="font-semibold text-secondary" data-testid="detail-ref">{c.ref}</span> · {AD_TYPE_INFO[c.adType as AdType]?.label}</p>
      </header>

      {c.status === "pending" && (
        <Banner tone="pending" title="Waiting for review">
          <span className="inline-flex items-center gap-1"><Clock size={12} aria-hidden={true} /> An administrator will review your campaign, confirm pricing and payment, then approve or reject it.</span>
        </Banner>
      )}
      {c.status === "rejected" && (
        <Banner tone="rejected" title="Campaign rejected">
          <p data-testid="rejection-reason">{c.rejectionReason ?? "No reason was provided."}</p>
          <p className="mt-1">You can reopen it as a draft, fix it and submit again.</p>
        </Banner>
      )}
      {c.status === "paused" && (
        <Banner tone="processing" title={c.pausedBy === "admin" ? "Paused by Onfile" : "Paused"}>
          {c.pausedBy === "admin" ? "Only an administrator can resume this campaign." : "Your ad isn't being shown. Resume it any time."}
        </Banner>
      )}
      {c.status === "completed" && (
        <Banner tone="completed" title="Campaign completed">
          {c.completionReason ? COMPLETION_REASON_LABELS[c.completionReason as CompletionReason] ?? c.completionReason : "This campaign has finished."}
        </Banner>
      )}

      <div className="flex flex-wrap gap-2">
        {cap.edit && <button type="button" onClick={onEdit} className="btn-primary min-h-11 px-4 text-sm inline-flex items-center gap-2"><Pencil size={14} aria-hidden={true} /> Edit &amp; submit</button>}
        {cap.pause && <button type="button" onClick={onPause} className="btn-secondary min-h-11 px-4 text-sm inline-flex items-center gap-2"><Pause size={14} aria-hidden={true} /> Pause campaign</button>}
        {cap.resume && <button type="button" onClick={onResume} className="btn-secondary min-h-11 px-4 text-sm inline-flex items-center gap-2"><Play size={14} aria-hidden={true} /> Resume campaign</button>}
        {cap.reopen && <button type="button" onClick={onReopen} className="btn-primary min-h-11 px-4 text-sm inline-flex items-center gap-2"><RotateCcw size={14} aria-hidden={true} /> Reopen as draft</button>}
        {cap.remove && <button type="button" onClick={onDelete} className="btn-secondary min-h-11 px-4 text-sm inline-flex items-center gap-2 text-red-500"><Trash2 size={14} aria-hidden={true} /> Delete draft</button>}
      </div>

      <Card title="Budget & spending">
        <div className="grid grid-cols-3 gap-x-3 gap-y-3">
          <Stat label="Budget" value={formatMoney(c.budget, c.currency)} />
          <Stat label="Spent" value={formatMoney(c.spent, c.currency)} />
          <Stat label="Remaining" value={formatMoney(c.remaining, c.currency)} />
        </div>
        <p className="text-xs text-muted mt-3">
          {c.pricing ? `Confirmed pricing: ${formatMoney(c.pricing.unitPrice, c.currency)} ${PRICING_MODEL_LABELS[c.pricing.model]}.` : "Pricing: pending admin confirmation."} Payment: {c.payment.label}.
        </p>
        {!c.pricing && c.status !== "draft" && <p className="text-xs text-muted mt-1">{PRICING_NOTICE}</p>}
      </Card>

      <div ref={perfRef} />
      <Card title="Performance" id="performance">
        <div className="grid grid-cols-3 gap-x-3 gap-y-3">
          <Stat label="Impressions" value={formatCount(c.impressions)} />
          <Stat label="Clicks" value={formatCount(c.clicks)} />
          <Stat label="CTR" value={formatPercent(c.ctr)} sub={c.ctr === null ? "No impressions yet" : undefined} />
          {c.objective === "verified_joins" && <Stat label="Verified joins" value={formatCount(c.verifiedJoins)} />}
        </div>
        {c.progress && objective && (
          <div className="mt-3.5">
            <div className="flex justify-between text-xs text-secondary mb-1">
              <span>Target completion: {formatCount(c.progress.current)} / {formatCount(c.progress.target)} {objective.unit}</span>
              <span>{c.progress.percent}%</span>
            </div>
            <ProgressBar percent={c.progress.percent} label="Target completion" />
          </div>
        )}

        {analytics && !analytics.hasData ? (
          <div className="mt-3.5 rounded-xl bg-secondary p-4 text-center" data-testid="analytics-empty">
            <p className="text-sm font-semibold text-primary">No activity recorded yet</p>
            <p className="text-xs text-secondary mt-0.5">
              {c.status === "active" ? "Impressions and clicks will appear here as your ad is shown." : "Data appears once the campaign is active and your ad is shown."}
            </p>
          </div>
        ) : analytics ? (
          <div className="mt-3.5 flex flex-col gap-4">
            <div>
              <p className="text-xs font-semibold text-secondary mb-2">Last 30 days (recorded events)</p>
              <ul className="flex flex-col gap-1.5">
                {analytics.daily.slice(-14).map((d) => (
                  <li key={d.date} className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-2 text-[11px]">
                    <span className="text-muted">{d.date.slice(5)}</span>
                    <span className="flex flex-col gap-0.5 min-w-0">
                      <span className="h-1.5 rounded-full bg-[#FF6115]" style={{ width: `${Math.max(3, (d.impressions / maxDaily) * 100)}%` }} />
                      <span className="h-1.5 rounded-full bg-blue-500" style={{ width: `${Math.max(d.clicks ? 3 : 0, (d.clicks / maxDaily) * 100)}%` }} />
                    </span>
                    <span className="text-secondary whitespace-nowrap">{d.impressions} / {d.clicks}</span>
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-muted mt-1.5"><span className="inline-block w-2 h-2 rounded-full bg-[#FF6115] mr-1" />Impressions <span className="inline-block w-2 h-2 rounded-full bg-blue-500 ml-2 mr-1" />Clicks</p>
            </div>
            {analytics.byPlacement.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-secondary mb-1.5">By placement</p>
                <ul className="divide-y divide-[var(--color-border-light)]">
                  {analytics.byPlacement.map((p) => (
                    <li key={p.placement} className="flex justify-between gap-2 py-1.5 text-xs">
                      <span className="text-primary truncate">{PLACEMENTS.find((x) => x.key === p.placement)?.label ?? p.placement}</span>
                      <span className="text-secondary whitespace-nowrap">{p.impressions} impr. · {p.clicks} clicks</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : null}
      </Card>

      <Card title="Campaign">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-secondary">Objective</dt><dd className="text-primary text-right break-words">{objective?.label ?? "—"}</dd>
          <dt className="text-secondary">Schedule</dt><dd className="text-primary text-right">{formatDay(c.startDate)} → {formatDay(c.endDate)}</dd>
          <dt className="text-secondary">Placements</dt><dd className="text-primary text-right break-words">{c.placements.map((k) => PLACEMENTS.find((p) => p.key === k)?.label ?? k).join(", ") || "—"}</dd>
          <dt className="text-secondary">Countries</dt><dd className="text-primary text-right break-words">{c.targeting.countries.join(", ") || "Everyone"}</dd>
          <dt className="text-secondary">Languages</dt><dd className="text-primary text-right break-words">{c.targeting.languages.join(", ") || "Everyone"}</dd>
          <dt className="text-secondary">Submitted</dt><dd className="text-primary text-right">{formatDay(c.submittedAt)}</dd>
          {c.reviewedAt && (<><dt className="text-secondary">Reviewed</dt><dd className="text-primary text-right">{formatDay(c.reviewedAt)}</dd></>)}
        </dl>
      </Card>

      <Card title="Ad preview">
        <AdPreview adType={c.adType as AdType} contentKind={c.contentKind} headline={c.headline} description={c.description} ctaText={c.ctaText} thumbnailUrl={c.thumbnailUrl} label={c.destinationLabel} />
      </Card>
    </div>
  );
}
