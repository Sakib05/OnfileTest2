"use client";
import React, { useMemo, useState } from "react";
import { AlertTriangle, Eye, Megaphone, MousePointerClick, Plus, RefreshCw, UserPlus, Wallet, Layers, Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Overview, PublicCampaign } from "@/lib/ads/serialize";
import { STATUS_LABELS, type CampaignStatus } from "@/lib/ads/constants";
import CampaignCard from "./CampaignCard";
import { formatCount, formatMoney } from "./format";

type Filter = CampaignStatus | "all";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All Campaigns" },
  { key: "draft", label: STATUS_LABELS.draft },
  { key: "pending", label: STATUS_LABELS.pending },
  { key: "active", label: STATUS_LABELS.active },
  { key: "paused", label: STATUS_LABELS.paused },
  { key: "completed", label: STATUS_LABELS.completed },
  { key: "rejected", label: STATUS_LABELS.rejected },
];

const DOT: Record<Filter, string> = {
  all: "bg-[#FF6115]",
  draft: "bg-gray-400",
  pending: "bg-yellow-500",
  active: "bg-green-500",
  paused: "bg-blue-500",
  completed: "bg-orange-400",
  rejected: "bg-red-500",
};

function Metric({ icon: Icon, label, value, hint }: { icon: React.ComponentType<{ size?: number; "aria-hidden"?: boolean }>; label: string; value: string; hint?: string }) {
  return (
    <div className="bg-card border border-app rounded-2xl p-3 min-w-0" data-testid="metric">
      <div className="flex items-center gap-1.5 text-muted mb-1">
        <Icon size={14} aria-hidden={true} />
        <p className="text-[11px] truncate">{label}</p>
      </div>
      <p className="text-lg font-bold text-primary truncate leading-tight">{value}</p>
      {hint && <p className="text-[11px] text-muted truncate">{hint}</p>}
    </div>
  );
}

export default function AdvertiseDashboard({
  campaigns,
  overview,
  loading,
  error,
  pricingNotice,
  onRetry,
  onCreate,
  onOpen,
  onPerformance,
  onEdit,
  onPause,
  onResume,
}: {
  campaigns: PublicCampaign[] | null;
  overview: Overview | null;
  loading: boolean;
  error: string | null;
  pricingNotice: string | null;
  onRetry: () => void;
  onCreate: () => void;
  onOpen: (c: PublicCampaign) => void;
  onPerformance: (c: PublicCampaign) => void;
  onEdit: (c: PublicCampaign) => void;
  onPause: (c: PublicCampaign) => void;
  onResume: (c: PublicCampaign) => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const shown = useMemo(() => (campaigns ?? []).filter((c) => filter === "all" || c.status === filter), [campaigns, filter]);

  return (
    <div className="flex flex-col gap-5 animate-fade-in min-w-0">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-primary">Advertising</h1>
          <p className="text-sm text-secondary mt-0.5">Promote your content and grow your audience with Onfile.</p>
        </div>
      </header>
      <button type="button" onClick={onCreate} className="btn-primary min-h-12 w-full text-sm inline-flex items-center justify-center gap-2" data-testid="create-campaign">
        <Plus size={18} aria-hidden={true} /> Create Campaign
      </button>

      {error && !campaigns ? (
        <div className="bg-card border border-app rounded-2xl p-6 text-center flex flex-col items-center gap-3" data-testid="ads-error">
          <AlertTriangle size={28} className="text-muted" aria-hidden={true} />
          <p className="text-sm text-secondary">{error}</p>
          <button type="button" onClick={onRetry} className="btn-primary min-h-11 px-6 text-sm inline-flex items-center gap-2"><RefreshCw size={15} aria-hidden={true} /> Try again</button>
        </div>
      ) : loading && !campaigns ? (
        <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading campaigns" data-testid="ads-skeleton">
          <div className="grid grid-cols-2 gap-2.5">{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="h-20 rounded-2xl bg-secondary animate-pulse-brand" />)}</div>
          {[0, 1].map((i) => <div key={i} className="h-44 rounded-2xl bg-secondary animate-pulse-brand" />)}
        </div>
      ) : (
        <>
          <section aria-label="Campaign overview">
            <h2 className="text-sm font-bold text-primary mb-2">Campaign overview</h2>
            <div className="grid grid-cols-2 gap-2.5">
              <Metric icon={Layers} label="Total campaigns" value={formatCount(overview?.totalCampaigns ?? 0)} />
              <Metric icon={Activity} label="Active campaigns" value={formatCount(overview?.activeCampaigns ?? 0)} />
              <Metric icon={Eye} label="Total impressions" value={formatCount(overview?.impressions ?? 0)} />
              <Metric icon={MousePointerClick} label="Total clicks" value={formatCount(overview?.clicks ?? 0)} />
              <Metric icon={UserPlus} label="Verified joins" value={overview?.verifiedJoins === null || overview?.verifiedJoins === undefined ? "N/A" : formatCount(overview.verifiedJoins)} hint={overview?.verifiedJoins === null ? "No join campaigns" : undefined} />
              <Metric icon={Wallet} label="Total spending" value={formatMoney(overview?.spent ?? 0, overview?.currency)} hint="Recorded spend" />
            </div>
          </section>

          <section aria-label="Campaigns" className="min-w-0">
            <div className="-mx-4 px-4 overflow-x-auto no-scrollbar" role="tablist" aria-label="Filter campaigns by status">
              <div className="flex gap-2 w-max pb-1">
                {FILTERS.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    role="tab"
                    aria-selected={filter === f.key}
                    onClick={() => setFilter(f.key)}
                    className={cn("min-h-10 px-3.5 rounded-full border text-xs font-semibold inline-flex items-center gap-2 whitespace-nowrap", filter === f.key ? "border-[#FF6115] bg-brand-10 text-primary" : "border-app bg-card text-secondary")}
                  >
                    <span className={cn("w-2 h-2 rounded-full", DOT[f.key])} aria-hidden={true} />
                    {f.label}
                    <span className="text-muted">{overview?.counts[f.key] ?? 0}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-3 mt-3" role="tabpanel">
              {shown.length === 0 ? (
                <div className="bg-card border border-app rounded-2xl p-8 text-center flex flex-col items-center gap-2" data-testid="ads-empty">
                  <Megaphone size={30} className="text-muted opacity-50" aria-hidden={true} />
                  <p className="text-sm font-semibold text-primary">{filter === "all" ? "No campaigns yet" : `No ${STATUS_LABELS[filter as CampaignStatus].toLowerCase()} campaigns`}</p>
                  <p className="text-xs text-secondary max-w-[16rem]">{filter === "all" ? "Create your first campaign to promote a file, playlist or Telegram channel." : "Campaigns with this status will appear here."}</p>
                  {filter === "all" && <button type="button" onClick={onCreate} className="btn-primary min-h-11 px-5 text-sm mt-2">Create Campaign</button>}
                </div>
              ) : (
                shown.map((c) => (
                  <CampaignCard key={c.ref} c={c} onOpen={() => onOpen(c)} onPerformance={() => onPerformance(c)} onEdit={() => onEdit(c)} onPause={() => onPause(c)} onResume={() => onResume(c)} />
                ))
              )}
            </div>
          </section>

          {pricingNotice && <p className="text-xs text-muted leading-relaxed">{pricingNotice}</p>}
        </>
      )}
    </div>
  );
}
