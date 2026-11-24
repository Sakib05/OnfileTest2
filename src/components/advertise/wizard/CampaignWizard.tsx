"use client";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/Toast";
import Modal from "@/components/ui/Modal";
import { useTelegramBackButton } from "@/lib/useTelegramBackButton";
import { DEFAULT_CTA, OBJECTIVES_BY_TYPE, STATUS_LABELS } from "@/lib/ads/constants";
import { validateCampaignInput } from "@/lib/ads/validation";
import type { PublicCampaign } from "@/lib/ads/serialize";
import { emptyState, fromCampaign, STEPS, stepForField, toBody, type PickedItem, type ResolvedInfo, type StepIndex, type WizardState } from "./state";
import { StepAudience, StepBudget, StepCreative, StepObjective, StepPlacements, StepReview, StepType, type Errors, type WizardOptions } from "./steps";

const STORAGE_KEY = "onfile_ad_wizard_v1";
/** Steps where Continue stays disabled until a choice is made. On form steps it stays tappable and shows what's wrong. */
const SELECTION_STEPS = new Set<number>([0, 1, 3]);

async function api<T>(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: T & { error?: string; fieldErrors?: Errors } }> {
  try {
    const res = await fetch(url, init);
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: "Network error. Check your connection and try again." } as never };
  }
}
const jsonInit = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/** Client-side gate only (fast feedback). The server re-validates everything on save and submit. */
function stepErrors(s: WizardState, step: StepIndex): Errors {
  const v = validateCampaignInput(toBody(s), "submit");
  const all = v.ok ? {} : v.errors;
  const out: Errors = {};
  for (const [k, msg] of Object.entries(all)) if (stepForField(k) === step) out[k] = msg;
  return out;
}

function loadStored(): WizardState | null {
  try {
    const raw = typeof window !== "undefined" ? window.sessionStorage.getItem(STORAGE_KEY) : null;
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WizardState;
    return parsed && typeof parsed === "object" && parsed.clientRef ? { ...emptyState(), ...parsed } : null;
  } catch {
    return null;
  }
}

export default function CampaignWizard({
  initial,
  onExit,
  onOpenCampaign,
}: {
  /** An existing draft to edit, or null for a new campaign. */
  initial: PublicCampaign | null;
  /** Leave the wizard; `changed` tells the dashboard to reload. */
  onExit: (changed: boolean) => void;
  onOpenCampaign: (ref: string) => void;
}) {
  const { toast } = useToast();
  const [options, setOptions] = useState<WizardOptions | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [s, setS] = useState<WizardState>(() => (initial ? fromCampaign(initial, emptyState().clientRef) : loadStored() ?? emptyState()));
  const [step, setStep] = useState<StepIndex>(initial ? 6 : 0);
  const [maxReached, setMaxReached] = useState<StepIndex>(initial ? 6 : 0);
  const [errors, setErrors] = useState<Errors>({});
  const [picked, setPicked] = useState<PickedItem | null>(null);
  const [resolved, setResolved] = useState<ResolvedInfo | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "save" | "submit">(null);
  const [dirty, setDirty] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);
  const [done, setDone] = useState<PublicCampaign | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const guard = useRef(false);
  const topRef = useRef<HTMLDivElement>(null);
  const sRef = useRef(s);
  useEffect(() => { sRef.current = s; });

  // Persist unsaved work for this browser session so an accidental close / refresh doesn't lose it.
  useEffect(() => {
    if (done) return;
    try {
      if (dirty || !initial) window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    } catch { /* storage unavailable: server drafts still work */ }
  }, [s, dirty, done, initial]);

  const loadOptions = useCallback(async () => {
    setOptionsError(null);
    const r = await api<WizardOptions>("/api/advertise/options");
    if (r.ok) setOptions(r.data);
    else setOptionsError(r.data.error ?? "Couldn't load your content.");
  }, []);
  useEffect(() => {
    // Initial data load for the wizard.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadOptions();
  }, [loadOptions]);

  // When options arrive (or a draft is opened), recover the preview item for already-selected content.
  useEffect(() => {
    if (!options) return;
    const cur = sRef.current;
    if (cur.adType !== "onfile_content") return;
    const item = cur.contentKind === "file" ? options.files.find((f) => f.id === cur.fileId) : options.playlists.find((p) => p.id === cur.playlistId);
    if (item) setPicked({ title: item.title, thumbnailUrl: item.thumbnailUrl });
  }, [options]);

  const patch = useCallback((p: Partial<WizardState>) => {
    setS((cur) => ({ ...cur, ...p }));
    setDirty(true);
    setSubmitError(null);
    setErrors((cur) => {
      const next = { ...cur };
      for (const k of Object.keys(p)) delete next[k];
      return next;
    });
  }, []);

  const goTo = useCallback((n: StepIndex) => {
    setStep(n);
    setMaxReached((m) => (n > m ? n : m));
    topRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }, []);

  const verifyDestination = useCallback(async () => {
    setResolving(true);
    setResolveError(null);
    const r = await api<{ destination: ResolvedInfo }>("/api/advertise/resolve", jsonInit("POST", toBody(sRef.current)));
    setResolving(false);
    if (r.ok) {
      setResolved(r.data.destination);
      setS((cur) => (cur.objective === "verified_joins" && !r.data.destination.joinVerifiable ? { ...cur, objective: null } : cur));
    } else {
      setResolved(null);
      setResolveError(r.data.error ?? "Couldn't check that destination.");
    }
  }, []);

  // Re-open an existing external/channel/post draft: re-check its destination so the preview + objectives are honest.
  const autoVerified = useRef(false);
  useEffect(() => {
    if (!initial || !options || autoVerified.current) return;
    if (initial.adType === "telegram_channel" || initial.adType === "telegram_post") {
      autoVerified.current = true;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void verifyDestination();
    }
  }, [initial, options, verifyDestination]);

  const onDestinationChange = useCallback(() => {
    setResolved(null);
    setResolveError(null);
  }, []);

  const destinationReady = useMemo(() => {
    if (!s.adType) return false;
    if (s.adType === "onfile_content") {
      return s.contentKind === "file" ? !!s.fileId && !!options?.files.find((f) => f.id === s.fileId)?.eligible : !!s.playlistId && !!options?.playlists.find((p) => p.id === s.playlistId)?.eligible;
    }
    return resolved !== null;
  }, [s.adType, s.contentKind, s.fileId, s.playlistId, resolved, options]);

  const canContinue = (n: StepIndex): boolean => {
    switch (n) {
      case 0: return destinationReady;
      case 1: return !!s.objective && !!s.adType && OBJECTIVES_BY_TYPE[s.adType].includes(s.objective);
      case 2: return Object.keys(stepErrors(s, 2)).length === 0;
      case 3: return s.placements.length > 0 && (!s.placements.includes("force_join") || !!s.fileId);
      case 4: return Object.keys(stepErrors(s, 4)).length === 0;
      case 5: return Object.keys(stepErrors(s, 5)).length === 0;
      default: return true;
    }
  };

  const next = () => {
    const e = stepErrors(s, step);
    if (Object.keys(e).length > 0 || !canContinue(step)) {
      setErrors(e);
      return;
    }
    // Sensible defaults when entering the creative step.
    if (step === 1 && s.adType && !s.ctaText) patch({ ctaText: DEFAULT_CTA[s.adType] });
    goTo(Math.min(6, step + 1) as StepIndex);
  };

  const save = useCallback(async (): Promise<string | null> => {
    const cur = sRef.current;
    const r = cur.ref
      ? await api<{ campaign: PublicCampaign }>(`/api/advertise/${cur.ref}`, jsonInit("PATCH", toBody(cur)))
      : await api<{ campaign: PublicCampaign }>("/api/advertise", jsonInit("POST", toBody(cur)));
    if (!r.ok) {
      if (r.data.fieldErrors) setErrors(r.data.fieldErrors);
      setSubmitError(r.data.error ?? "Couldn't save the draft.");
      return null;
    }
    setS((c) => ({ ...c, ref: r.data.campaign.ref }));
    sRef.current = { ...sRef.current, ref: r.data.campaign.ref };
    setDirty(false);
    return r.data.campaign.ref;
  }, []);

  const saveDraft = async (thenExit = false) => {
    if (guard.current) return;
    if (!sRef.current.adType) { toast("Choose what to promote first.", "error"); return; }
    guard.current = true;
    setBusy("save");
    const ref = await save();
    guard.current = false;
    setBusy(null);
    if (ref) {
      toast("Draft saved");
      if (thenExit) {
        try { window.sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
        onExit(true);
      }
    }
  };

  const submit = async () => {
    if (guard.current) return; // double-tap guard (the server is idempotent too)
    const v = validateCampaignInput(toBody(s), "submit");
    if (!v.ok) {
      setErrors(v.errors);
      goTo(Math.min(...Object.keys(v.errors).map((k) => stepForField(k))) as StepIndex);
      setSubmitError("Your campaign isn't complete yet.");
      return;
    }
    guard.current = true;
    setBusy("submit");
    setSubmitError(null);
    const ref = await save();
    if (!ref) { guard.current = false; setBusy(null); return; }
    const r = await api<{ campaign: PublicCampaign }>(`/api/advertise/${ref}/action`, jsonInit("POST", { action: "submit" }));
    guard.current = false;
    setBusy(null);
    if (!r.ok) {
      const fe = r.data.fieldErrors ?? {};
      setErrors(fe);
      setSubmitError(r.data.error ?? "Couldn't submit your campaign.");
      const keys = Object.keys(fe);
      if (keys.length) goTo(Math.min(...keys.map((k) => stepForField(k))) as StepIndex);
      return;
    }
    try { window.sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    setDone(r.data.campaign);
  };

  const requestExit = useCallback(() => {
    if (dirty) setConfirmExit(true);
    else {
      try { if (!initial && !sRef.current.ref) window.sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
      onExit(false);
    }
  }, [dirty, initial, onExit]);

  const discard = () => {
    try { window.sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    setConfirmExit(false);
    onExit(false);
  };

  // Native Back steps back through the wizard; on the first step it leaves (asking before dropping unsaved work).
  useTelegramBackButton(() => {
    if (guard.current) return;
    if (step > 0) goTo((step - 1) as StepIndex);
    else requestExit();
  }, !done);

  if (done) {
    return (
      <div className="flex flex-col items-center text-center gap-4 py-8 animate-fade-in" data-testid="submit-success">
        <div className="w-16 h-16 rounded-full status-completed flex items-center justify-center"><CheckCircle2 size={32} aria-hidden={true} /></div>
        <div>
          <h2 className="text-xl font-bold text-primary">Campaign submitted</h2>
          <p className="text-sm text-secondary mt-1">Status: <b>{STATUS_LABELS[done.status]}</b></p>
        </div>
        <div className="bg-card border border-app rounded-2xl px-5 py-3">
          <p className="text-xs text-muted">Campaign reference</p>
          <p className="text-lg font-bold text-primary tracking-wider" data-testid="campaign-ref">{done.ref}</p>
        </div>
        <p className="text-sm text-secondary max-w-xs">Your campaign is <b>not live yet</b>. An Onfile administrator will review it, confirm pricing and payment, and then it can start on {done.config.startDate || "its start date"}.</p>
        <div className="flex flex-col gap-2 w-full max-w-xs">
          <button type="button" className="btn-primary min-h-11 text-sm" onClick={() => onOpenCampaign(done.ref)}>View campaign</button>
          <button type="button" className="btn-secondary min-h-11 text-sm" onClick={() => onExit(true)}>Back to Advertising</button>
        </div>
      </div>
    );
  }

  if (optionsError) {
    return (
      <div className="bg-card border border-app rounded-2xl p-6 text-center flex flex-col items-center gap-3">
        <AlertTriangle size={28} className="text-muted" aria-hidden={true} />
        <p className="text-sm text-secondary">{optionsError}</p>
        <button type="button" className="btn-primary min-h-11 px-6 text-sm inline-flex items-center gap-2" onClick={() => void loadOptions()}><RefreshCw size={15} aria-hidden={true} /> Try again</button>
      </div>
    );
  }
  if (!options) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading">
        <div className="h-10 rounded-xl bg-secondary animate-pulse-brand" />
        {[0, 1, 2].map((i) => <div key={i} className="h-16 rounded-2xl bg-secondary animate-pulse-brand" />)}
      </div>
    );
  }

  const isReview = step === 6;
  return (
    <div className="flex flex-col gap-4 animate-fade-in" ref={topRef}>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-bold text-primary truncate">{s.ref ? "Edit campaign" : "Create campaign"}</h1>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => void saveDraft(false)} disabled={busy !== null || !s.adType} className="text-xs font-semibold text-brand min-h-10 px-3 disabled:opacity-40" data-testid="save-draft">
            {busy === "save" ? "Saving…" : "Save draft"}
          </button>
          <button type="button" onClick={requestExit} className="text-xs font-semibold text-secondary min-h-10 px-3">Cancel</button>
        </div>
      </div>

      {/* progress */}
      <nav aria-label="Campaign steps">
        <p className="text-xs text-secondary mb-2" aria-live="polite">Step {step + 1} of {STEPS.length} · <b className="text-primary">{STEPS[step]}</b></p>
        <ol className="flex gap-1.5">
          {STEPS.map((label, i) => {
            const reachable = i <= maxReached && i !== step;
            return (
              <li key={label} className="flex-1 min-w-0">
                <button type="button" disabled={!reachable} onClick={() => goTo(i as StepIndex)} aria-label={`${label}${i < step ? " (completed)" : i === step ? " (current)" : ""}`} aria-current={i === step ? "step" : undefined} className="w-full h-6 flex items-center">
                  <span className={cn("h-1.5 w-full rounded-full transition-colors", i === step ? "bg-[#FF6115]" : i < step || i <= maxReached ? "bg-[#FF6115]/50" : "bg-secondary")} />
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <div data-testid={`wizard-step-${step}`}>
        {step === 0 && <StepType s={s} patch={patch} errors={errors} options={options} resolved={resolved} resolving={resolving} resolveError={resolveError} onVerify={() => void verifyDestination()} onDestinationChange={onDestinationChange} onPick={setPicked} />}
        {step === 1 && <StepObjective s={s} patch={patch} errors={errors} resolved={resolved} />}
        {step === 2 && <StepCreative s={s} patch={patch} errors={errors} picked={picked} resolved={resolved} />}
        {step === 3 && <StepPlacements s={s} patch={patch} errors={errors} options={options} resolved={resolved} />}
        {step === 4 && <StepAudience s={s} patch={patch} errors={errors} options={options} />}
        {step === 5 && <StepBudget s={s} patch={patch} errors={errors} />}
        {step === 6 && <StepReview s={s} errors={errors} onEdit={goTo} picked={picked} resolved={resolved} options={options} />}
      </div>

      {submitError && <p role="alert" className="text-sm text-red-500 break-words">{submitError}</p>}

      <div className="flex gap-3 pt-1">
        {step > 0 && (
          <button type="button" onClick={() => goTo((step - 1) as StepIndex)} disabled={busy !== null} className="btn-secondary min-h-12 flex-1 text-sm">Back</button>
        )}
        {!isReview ? (
          <button type="button" onClick={next} disabled={SELECTION_STEPS.has(step) && !canContinue(step)} className="btn-primary min-h-12 flex-[2] text-sm disabled:opacity-50 disabled:shadow-none" data-testid="continue">
            Continue
          </button>
        ) : (
          <button type="button" onClick={() => void submit()} disabled={busy !== null} className="btn-primary min-h-12 flex-[2] text-sm inline-flex items-center justify-center gap-2 disabled:opacity-60" data-testid="submit-campaign">
            {busy === "submit" ? <Loader2 size={16} className="animate-spin" aria-hidden={true} /> : <Check size={16} aria-hidden={true} />}
            {busy === "submit" ? "Submitting…" : "Submit for review"}
          </button>
        )}
      </div>

      <Modal open={confirmExit} onClose={() => setConfirmExit(false)} title="Leave without saving?" size="sm">
        <p className="text-sm text-secondary mb-4">You have unsaved changes to this campaign.</p>
        <div className="flex flex-col gap-2">
          <button type="button" className="btn-primary min-h-11 text-sm" onClick={() => { setConfirmExit(false); void saveDraft(true); }} disabled={!s.adType}>Save draft &amp; leave</button>
          <button type="button" className="btn-secondary min-h-11 text-sm" onClick={discard}>Discard changes</button>
          <button type="button" className="min-h-11 text-sm font-semibold text-secondary" onClick={() => setConfirmExit(false)}>Keep editing</button>
        </div>
      </Modal>
    </div>
  );
}
