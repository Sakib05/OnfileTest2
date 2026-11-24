"use client";
import React, { useCallback, useEffect, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import Modal from "@/components/ui/Modal";
import { useTelegramBackButton } from "@/lib/useTelegramBackButton";
import type { Overview, PublicCampaign } from "@/lib/ads/serialize";
import AdvertiseDashboard from "./AdvertiseDashboard";
import CampaignDetails, { type AnalyticsData } from "./CampaignDetails";
import CampaignWizard from "./wizard/CampaignWizard";

type View =
  | { name: "dashboard" }
  | { name: "wizard"; draft: PublicCampaign | null }
  | { name: "details"; ref: string; performance: boolean };

type PendingAction = { c: PublicCampaign; action: "pause" | "resume" | "delete" | "reopen" } | null;

async function request<T>(url: string, init?: RequestInit): Promise<{ ok: boolean; data: T & { error?: string } }> {
  try {
    const res = await fetch(url, init);
    return { ok: res.ok, data: await res.json().catch(() => ({})) };
  } catch {
    return { ok: false, data: { error: "Network error. Check your connection and try again." } as never };
  }
}

/**
 * ME → Advertise. Dashboard ⇄ campaign wizard ⇄ campaign details, all inside the existing Profile sub-page (routing,
 * session and the native Back button are unchanged: the Profile tab still owns Back from the dashboard root, this
 * component stacks its own Back for the nested wizard/details views).
 */
export default function AdvertiseSection() {
  const { toast } = useToast();
  const [view, setView] = useState<View>({ name: "dashboard" });
  const [campaigns, setCampaigns] = useState<PublicCampaign[] | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [pricingNotice, setPricingNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<PublicCampaign | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction>(null);
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const r = await request<{ campaigns: PublicCampaign[]; overview: Overview; pricingNotice: string }>("/api/advertise");
    setLoading(false);
    if (r.ok) {
      setCampaigns(r.data.campaigns);
      setOverview(r.data.overview);
      setPricingNotice(r.data.pricingNotice);
    } else {
      setError(r.data.error ?? "Couldn't load your campaigns.");
    }
  }, []);

  useEffect(() => {
    // Initial load of the creator's own campaigns.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const loadDetail = useCallback(async (ref: string) => {
    setDetailLoading(true);
    setDetailError(null);
    const r = await request<{ campaign: PublicCampaign; analytics: AnalyticsData }>(`/api/advertise/${ref}`);
    setDetailLoading(false);
    if (r.ok) {
      setDetail(r.data.campaign);
      setAnalytics(r.data.analytics);
    } else {
      setDetailError(r.data.error ?? "Couldn't load this campaign.");
    }
  }, []);

  const detailRef = view.name === "details" ? view.ref : null;
  useEffect(() => {
    if (!detailRef) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDetail(null);
    setAnalytics(null);
    void loadDetail(detailRef);
  }, [detailRef, loadDetail]);

  const backToDashboard = useCallback(() => {
    setView({ name: "dashboard" });
    void load();
  }, [load]);

  // Details has no unsaved state, so native Back returns to the dashboard. (The wizard registers its own Back.)
  useTelegramBackButton(backToDashboard, view.name === "details");

  const openDetails = (c: PublicCampaign, performance = false) => setView({ name: "details", ref: c.ref, performance });

  const confirmAction = async () => {
    if (!pending || acting) return;
    setActing(true);
    const { c, action } = pending;
    const r = await request<{ campaign?: PublicCampaign; deleted?: boolean }>(`/api/advertise/${c.ref}/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    setActing(false);
    setPending(null);
    if (!r.ok) {
      toast(r.data.error ?? "That didn't work. Please try again.", "error");
      void load();
      if (detailRef) void loadDetail(detailRef);
      return;
    }
    toast(action === "pause" ? "Campaign paused" : action === "resume" ? "Campaign resumed" : action === "delete" ? "Draft deleted" : "Reopened as a draft");
    if (action === "delete") {
      setView({ name: "dashboard" });
    } else if (r.data.campaign) {
      setDetail(r.data.campaign);
      if (detailRef) void loadDetail(detailRef);
    }
    void load();
  };

  const copy: Record<NonNullable<PendingAction>["action"], { title: string; body: string; cta: string }> = {
    pause: { title: "Pause this campaign?", body: "Your ad stops being shown until you resume it.", cta: "Pause campaign" },
    resume: { title: "Resume this campaign?", body: "Your ad will be shown again within its schedule and budget.", cta: "Resume campaign" },
    delete: { title: "Delete this draft?", body: "This can't be undone.", cta: "Delete draft" },
    reopen: { title: "Reopen as a draft?", body: "You can edit it and submit it for review again.", cta: "Reopen" },
  };

  return (
    <>
      {view.name === "dashboard" && (
        <AdvertiseDashboard
          campaigns={campaigns}
          overview={overview}
          loading={loading}
          error={error}
          pricingNotice={pricingNotice}
          onRetry={() => void load()}
          onCreate={() => setView({ name: "wizard", draft: null })}
          onOpen={(c) => openDetails(c)}
          onPerformance={(c) => openDetails(c, true)}
          onEdit={(c) => setView({ name: "wizard", draft: c })}
          onPause={(c) => setPending({ c, action: "pause" })}
          onResume={(c) => setPending({ c, action: "resume" })}
        />
      )}
      {view.name === "wizard" && (
        <CampaignWizard
          key={view.draft?.ref ?? "new"}
          initial={view.draft}
          onExit={(changed) => {
            setView({ name: "dashboard" });
            if (changed) void load();
          }}
          onOpenCampaign={(ref) => {
            void load();
            setView({ name: "details", ref, performance: false });
          }}
        />
      )}
      {view.name === "details" && (
        <CampaignDetails
          campaign={detail}
          analytics={analytics}
          loading={detailLoading}
          error={detailError}
          focusPerformance={view.performance}
          onRetry={() => void loadDetail(view.ref)}
          onEdit={() => detail && setView({ name: "wizard", draft: detail })}
          onPause={() => detail && setPending({ c: detail, action: "pause" })}
          onResume={() => detail && setPending({ c: detail, action: "resume" })}
          onReopen={() => detail && setPending({ c: detail, action: "reopen" })}
          onDelete={() => detail && setPending({ c: detail, action: "delete" })}
        />
      )}

      <Modal open={!!pending} onClose={() => !acting && setPending(null)} title={pending ? copy[pending.action].title : undefined} size="sm">
        {pending && (
          <>
            <p className="text-sm text-secondary mb-4 break-words">{copy[pending.action].body}</p>
            <div className="flex flex-col gap-2">
              <button type="button" className="btn-primary min-h-11 text-sm disabled:opacity-60" onClick={() => void confirmAction()} disabled={acting} data-autofocus>
                {acting ? "Working…" : copy[pending.action].cta}
              </button>
              <button type="button" className="btn-secondary min-h-11 text-sm" onClick={() => setPending(null)} disabled={acting}>Cancel</button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
