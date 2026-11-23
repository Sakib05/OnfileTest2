"use client";
import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTelegramBackButton } from "@/lib/useTelegramBackButton";
import Modal from "@/components/ui/Modal";
import AdPreview from "@/components/advertise/AdPreview";
import StatusBadge from "@/components/advertise/StatusBadge";
import { formatCount, formatDay, formatMoney, formatPercent } from "@/components/advertise/format";
import { AD_TYPE_INFO, COMPLETION_REASON_LABELS, OBJECTIVE_INFO, PLACEMENTS, PRICING_MODEL_LABELS, type AdType, type CompletionReason } from "@/lib/ads/constants";
import type { PublicCampaign } from "@/lib/ads/serialize";

type AdminCampaign = PublicCampaign & { creator: { name: string; username: string | null } };
type Filter = "pending" | "active" | "paused" | "completed" | "rejected" | "all";
const FILTERS: Filter[] = ["pending", "active", "paused", "completed", "rejected", "all"];
type Action = "approve" | "reject" | "pause" | "resume" | "complete";

/**
 * Admin campaign review (/admin/ads). UI convenience only: the API (`/api/admin/ads`) independently requires an admin
 * session (ADMIN_TELEGRAM_IDS) for every read and write, so opening this URL as a non-admin shows nothing.
 */
export default function AdminAdsPage() {
  const router = useRouter();
  useTelegramBackButton(() => router.push("/"));
  const [filter, setFilter] = useState<Filter>("pending");
  const [rows, setRows] = useState<AdminCampaign[] | null>(null);
  const [legacy, setLegacy] = useState(0);
  const [state, setState] = useState<"loading" | "ready" | "forbidden" | "error">("loading");
  const [dialog, setDialog] = useState<{ c: AdminCampaign; action: Action } | null>(null);
  const [unitPrice, setUnitPrice] = useState("");
  const [paymentOk, setPaymentOk] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    try {
      const res = await fetch(`/api/admin/ads?status=${filter}`, { cache: "no-store" });
      if (res.status === 401 || res.status === 403) return setState("forbidden");
      if (!res.ok) return setState("error");
      const data = await res.json();
      setRows(data.campaigns);
      setLegacy(data.legacyCount ?? 0);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [filter]);

  useEffect(() => {
    // Load the review queue for the selected filter.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const openDialog = (c: AdminCampaign, action: Action) => {
    setDialog({ c, action });
    setUnitPrice("");
    setPaymentOk(false);
    setReason("");
    setFormError(null);
  };

  const submit = async () => {
    if (!dialog || busy) return;
    setBusy(true);
    setFormError(null);
    try {
      const res = await fetch("/api/admin/ads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ref: dialog.c.ref, action: dialog.action, unitPrice: unitPrice || undefined, paymentConfirmed: paymentOk, reason: reason || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFormError(data.error ?? "That didn't work.");
        return;
      }
      setDialog(null);
      void load();
    } catch {
      setFormError("Network error.");
    } finally {
      setBusy(false);
    }
  };

  if (state === "forbidden") {
    return <main className="min-h-screen bg-app grid place-items-center p-6"><p className="text-sm text-secondary">You don&apos;t have access to this page.</p></main>;
  }

  return (
    <main className="min-h-screen bg-app">
      <div className="mx-auto w-full max-w-2xl px-4 py-5 pb-24 flex flex-col gap-4 overflow-x-hidden">
        <div>
          <h1 className="text-xl font-bold text-primary">Campaign review</h1>
          <p className="text-sm text-secondary">Approve, reject and manage creator campaigns.</p>
        </div>
        <div className="-mx-4 px-4 overflow-x-auto no-scrollbar">
          <div className="flex gap-2 w-max">
            {FILTERS.map((f) => (
              <button key={f} type="button" onClick={() => setFilter(f)} aria-pressed={filter === f} className={cn("min-h-10 px-3.5 rounded-full border text-xs font-semibold capitalize", filter === f ? "border-[#FF6115] bg-brand-10 text-primary" : "border-app bg-card text-secondary")}>
                {f === "pending" ? "Pending review" : f}
              </button>
            ))}
          </div>
        </div>

        {state === "loading" && <div className="flex flex-col gap-3" aria-busy="true">{[0, 1].map((i) => <div key={i} className="h-40 rounded-2xl bg-secondary animate-pulse-brand" />)}</div>}
        {state === "error" && (
          <div className="bg-card border border-app rounded-2xl p-6 text-center flex flex-col items-center gap-3">
            <AlertTriangle size={26} className="text-muted" aria-hidden={true} />
            <p className="text-sm text-secondary">Couldn&apos;t load campaigns.</p>
            <button type="button" onClick={() => void load()} className="btn-primary min-h-11 px-5 text-sm inline-flex items-center gap-2"><RefreshCw size={14} aria-hidden={true} /> Retry</button>
          </div>
        )}
        {state === "ready" && rows && rows.length === 0 && <div className="bg-card border border-app rounded-2xl p-8 text-center text-sm text-secondary">No campaigns here.</div>}

        {state === "ready" && rows?.map((c) => {
          const expanded = open === c.ref;
          return (
            <article key={c.ref} className="bg-card border border-app rounded-2xl p-3.5 min-w-0" data-testid="admin-campaign" data-ref={c.ref}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="text-sm font-bold text-primary break-words">{c.title || c.headline}</h2>
                  <p className="text-xs text-secondary truncate">{c.ref} · {c.creator.name}{c.creator.username ? ` (@${c.creator.username})` : ""}</p>
                </div>
                <StatusBadge status={c.status} />
              </div>
              <p className="text-xs text-secondary mt-1.5">{AD_TYPE_INFO[c.adType as AdType]?.label} · {c.objective ? OBJECTIVE_INFO[c.objective].label : "—"}</p>
              <div className="grid grid-cols-3 gap-2 mt-3 text-xs">
                <div><p className="text-muted">Budget</p><p className="font-bold text-primary">{formatMoney(c.budget)}</p></div>
                <div><p className="text-muted">Spent</p><p className="font-bold text-primary">{formatMoney(c.spent)}</p></div>
                <div><p className="text-muted">Payment</p><p className="font-bold text-primary break-words">{c.payment.label}</p></div>
                <div><p className="text-muted">Impressions</p><p className="font-bold text-primary">{formatCount(c.impressions)}</p></div>
                <div><p className="text-muted">Clicks</p><p className="font-bold text-primary">{formatCount(c.clicks)}</p></div>
                <div><p className="text-muted">CTR</p><p className="font-bold text-primary">{formatPercent(c.ctr)}</p></div>
              </div>
              <button type="button" className="text-xs font-semibold text-brand min-h-10 mt-1" onClick={() => setOpen(expanded ? null : c.ref)} aria-expanded={expanded}>{expanded ? "Hide details" : "Review details & preview"}</button>
              {expanded && (
                <div className="flex flex-col gap-3 mt-2">
                  <AdPreview adType={c.adType as AdType} contentKind={c.contentKind} headline={c.headline} description={c.description} ctaText={c.ctaText} thumbnailUrl={c.thumbnailUrl} label={c.destinationLabel} />
                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
                    <dt className="text-secondary">Destination</dt><dd className="text-primary text-right break-all">{c.destinationUrl ?? c.config.destinationRef ?? "—"}</dd>
                    <dt className="text-secondary">Joins verifiable</dt><dd className="text-primary text-right">{c.objective === "verified_joins" ? (c.joinVerifiable ? "Yes (bot is admin)" : "No") : "n/a"}</dd>
                    <dt className="text-secondary">Placements</dt><dd className="text-primary text-right break-words">{c.placements.map((k) => PLACEMENTS.find((p) => p.key === k)?.label ?? k).join(", ") || "—"}</dd>
                    <dt className="text-secondary">Targeting</dt><dd className="text-primary text-right break-words">{[...c.targeting.countries, ...c.targeting.languages].join(", ") || "Everyone"}</dd>
                    <dt className="text-secondary">Schedule</dt><dd className="text-primary text-right">{formatDay(c.startDate)} → {formatDay(c.endDate)}</dd>
                    <dt className="text-secondary">Target</dt><dd className="text-primary text-right">{c.targetAmount ? formatCount(c.targetAmount) : "None"}</dd>
                    <dt className="text-secondary">Pricing</dt><dd className="text-primary text-right">{c.pricing ? `${formatMoney(c.pricing.unitPrice)} ${PRICING_MODEL_LABELS[c.pricing.model]}` : "Not set"}</dd>
                    {c.rejectionReason && (<><dt className="text-secondary">Rejection</dt><dd className="text-primary text-right break-words">{c.rejectionReason}</dd></>)}
                    {c.completionReason && (<><dt className="text-secondary">Completed</dt><dd className="text-primary text-right">{COMPLETION_REASON_LABELS[c.completionReason as CompletionReason] ?? c.completionReason}</dd></>)}
                  </dl>
                </div>
              )}
              <div className="flex flex-wrap gap-2 mt-2.5">
                {c.status === "pending" && (<>
                  <button type="button" className="btn-primary min-h-10 px-4 text-xs" onClick={() => openDialog(c, "approve")}>Approve…</button>
                  <button type="button" className="btn-secondary min-h-10 px-4 text-xs" onClick={() => openDialog(c, "reject")}>Reject…</button>
                </>)}
                {c.status === "active" && <button type="button" className="btn-secondary min-h-10 px-4 text-xs" onClick={() => openDialog(c, "pause")}>Pause</button>}
                {c.status === "paused" && <button type="button" className="btn-secondary min-h-10 px-4 text-xs" onClick={() => openDialog(c, "resume")}>Resume</button>}
                {(c.status === "active" || c.status === "paused") && <button type="button" className="btn-secondary min-h-10 px-4 text-xs" onClick={() => openDialog(c, "complete")}>Mark completed</button>}
              </div>
            </article>
          );
        })}
        {state === "ready" && legacy > 0 && <p className="text-xs text-muted">{legacy} legacy enquiry record{legacy === 1 ? "" : "s"} from the old form are preserved in the database and are not shown here.</p>}
      </div>

      <Modal open={!!dialog} onClose={() => !busy && setDialog(null)} title={dialog ? ({ approve: "Approve campaign", reject: "Reject campaign", pause: "Pause campaign", resume: "Resume campaign", complete: "Mark completed" } as const)[dialog.action] : undefined} size="sm">
        {dialog && (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-secondary break-words">{dialog.c.ref} · {dialog.c.title}</p>
            {dialog.action === "approve" && (<>
              <div>
                <label htmlFor="unit-price" className="text-xs font-semibold text-secondary">Unit price (USD) — {dialog.c.objective ? PRICING_MODEL_LABELS[OBJECTIVE_INFO[dialog.c.objective].pricingModel] : ""}</label>
                <input id="unit-price" className="input-app mt-1.5" inputMode="decimal" placeholder="e.g. 0.05" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value.replace(/[^\d.]/g, ""))} data-autofocus />
              </div>
              <label className="flex items-start gap-2 text-xs text-secondary">
                <input type="checkbox" className="mt-0.5" checked={paymentOk} onChange={(e) => setPaymentOk(e.target.checked)} />
                <span>I have confirmed the payment arrangement for the {formatMoney(dialog.c.budget)} budget. (No wallet is debited by this action.)</span>
              </label>
            </>)}
            {dialog.action === "reject" && (
              <div>
                <label htmlFor="reject-reason" className="text-xs font-semibold text-secondary">Reason shown to the creator</label>
                <textarea id="reject-reason" className="input-app mt-1.5 resize-none" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} data-autofocus />
              </div>
            )}
            {(dialog.action === "pause" || dialog.action === "resume" || dialog.action === "complete") && <p className="text-sm text-secondary">Confirm this action for the campaign.</p>}
            {formError && <p role="alert" className="text-xs text-red-500 break-words">{formError}</p>}
            <button type="button" className="btn-primary min-h-11 text-sm disabled:opacity-60" disabled={busy} onClick={() => void submit()}>{busy ? "Working…" : "Confirm"}</button>
            <button type="button" className="btn-secondary min-h-11 text-sm" disabled={busy} onClick={() => setDialog(null)}>Cancel</button>
          </div>
        )}
      </Modal>
    </main>
  );
}
