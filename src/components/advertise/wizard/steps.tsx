"use client";
import React from "react";
import { AlertTriangle, CheckCircle2, FileText, Info, ListMusic, Loader2, MessageSquareText, Send, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  AD_TYPES,
  AD_TYPE_INFO,
  LIMITS,
  OBJECTIVE_INFO,
  OBJECTIVES_BY_TYPE,
  PAYMENT_STATUS_LABELS,
  PLACEMENTS,
  PRICING_MODEL_LABELS,
  PRICING_NOTICE,
  placementsForType,
  type AdType,
  type PlacementDefinition,
} from "@/lib/ads/constants";
import AdPreview from "../AdPreview";
import { addDaysIso, daysBetween, formatMoney, todayIso } from "../format";
import type { PickedItem, ResolvedInfo, StepIndex, WizardState } from "./state";

export interface WizardOptions {
  files: { id: number; title: string; fileType: string | null; thumbnailUrl: string | null; eligible: boolean; reason: string | null }[];
  playlists: { id: number; title: string; totalFiles: number; thumbnailUrl: string | null; eligible: boolean; reason: string | null }[];
  channels: { id: number; name: string; username: string | null; isPrivate: boolean; botIsAdmin: boolean }[];
  countries: { code: string; label: string }[];
  languages: { code: string; label: string }[];
}

export type Errors = Record<string, string>;

export interface StepProps {
  s: WizardState;
  patch: (p: Partial<WizardState>) => void;
  errors: Errors;
}

export function FieldError({ msg }: { msg?: string }) {
  return msg ? (
    <p role="alert" className="text-xs text-red-500 mt-1.5 break-words">
      {msg}
    </p>
  ) : null;
}

function Label({ htmlFor, children, hint }: { htmlFor?: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="mb-1.5">
      <label htmlFor={htmlFor} className="text-xs font-semibold text-secondary">
        {children}
      </label>
      {hint && <span className="text-xs text-muted"> · {hint}</span>}
    </div>
  );
}

function Notice({ tone = "info", children }: { tone?: "info" | "warn"; children: React.ReactNode }) {
  const Icon = tone === "warn" ? AlertTriangle : Info;
  return (
    <div className={cn("flex gap-2 rounded-xl p-3 text-xs leading-relaxed break-words", tone === "warn" ? "status-pending" : "bg-secondary text-secondary")}>
      <Icon size={15} className="flex-shrink-0 mt-0.5" aria-hidden={true} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function Choice({ selected, disabled, onClick, children, label }: { selected: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      aria-label={label}
      className={cn(
        "w-full text-left rounded-2xl border p-3 flex gap-3 items-center transition-colors min-w-0 min-h-14",
        selected ? "border-[#FF6115] bg-brand-10" : "border-app bg-card",
        disabled && "opacity-50 cursor-not-allowed"
      )}
    >
      {children}
    </button>
  );
}

function Thumb({ url, children }: { url: string | null; children: React.ReactNode }) {
  return (
    <span className="w-11 h-11 rounded-xl bg-secondary text-muted flex items-center justify-center flex-shrink-0 overflow-hidden border border-app">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="w-full h-full object-cover" loading="lazy" />
      ) : (
        children
      )}
    </span>
  );
}

const TYPE_ICON: Record<AdType, React.ComponentType<{ size?: number; "aria-hidden"?: boolean }>> = {
  onfile_content: FileText,
  telegram_channel: Send,
  telegram_post: MessageSquareText,
};

// ─── Step 1 — type + destination ─────────────────────────────────────────────
export function StepType({
  s, patch, errors, options, resolved, resolving, resolveError, onVerify, onDestinationChange, onPick,
}: StepProps & {
  options: WizardOptions;
  resolved: ResolvedInfo | null;
  resolving: boolean;
  resolveError: string | null;
  onVerify: () => void;
  onDestinationChange: () => void;
  onPick: (item: PickedItem | null) => void;
}) {
  const choose = (t: AdType) => {
    if (t === s.adType) return;
    // Switching type clears everything that belonged to the old type; the objective is reset because it depends on the type.
    patch({ adType: t, contentKind: t === "onfile_content" ? "file" : null, fileId: null, playlistId: null, channelId: null, destinationRef: "", inviteLink: "", objective: null, placements: [], ctaText: "" });
    onPick(null);
    onDestinationChange();
  };
  const selectedChannel = options.channels.find((c) => c.id === s.channelId);
  const needsVerify = s.adType === "telegram_post" || (s.adType === "telegram_channel" && (s.channelMode === "external" || (selectedChannel && selectedChannel.isPrivate) || !!selectedChannel));

  return (
    <div className="flex flex-col gap-5">
      <div role="group" aria-label="Advertisement type" className="flex flex-col gap-2">
        {AD_TYPES.map((t) => {
          const Icon = TYPE_ICON[t];
          return (
            <Choice key={t} selected={s.adType === t} onClick={() => choose(t)}>
              <Thumb url={null}><Icon size={20} aria-hidden={true} /></Thumb>
              <span className="min-w-0">
                <span className="block text-sm font-bold text-primary">{AD_TYPE_INFO[t].label}</span>
                <span className="block text-xs text-secondary">{AD_TYPE_INFO[t].description}</span>
              </span>
            </Choice>
          );
        })}
        <FieldError msg={errors.adType} />
      </div>

      {s.adType === "onfile_content" && (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-secondary" role="group" aria-label="Content kind">
            {(["file", "playlist"] as const).map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={s.contentKind === k}
                onClick={() => { patch({ contentKind: k, fileId: null, playlistId: null }); onPick(null); }}
                className={cn("min-h-10 rounded-lg text-sm font-semibold", s.contentKind === k ? "bg-card text-primary shadow-app-sm" : "text-secondary")}
              >
                {k === "file" ? "File" : "Playlist"}
              </button>
            ))}
          </div>
          {s.contentKind === "file" && (
            options.files.length === 0 ? (
              <Notice>You haven&apos;t published any files yet. Publish a file from the Create tab, then come back.</Notice>
            ) : (
              <div className="flex flex-col gap-2" role="group" aria-label="Your files">
                {options.files.map((f) => (
                  <Choice key={f.id} selected={s.fileId === f.id} disabled={!f.eligible} onClick={() => { patch({ fileId: f.id }); onPick({ title: f.title, thumbnailUrl: f.thumbnailUrl }); }}>
                    <Thumb url={f.thumbnailUrl}><FileText size={18} aria-hidden={true} /></Thumb>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-primary line-clamp-1 break-words">{f.title}</span>
                      <span className="block text-xs text-secondary">{f.eligible ? (f.fileType ?? "file") : f.reason}</span>
                    </span>
                  </Choice>
                ))}
              </div>
            )
          )}
          {s.contentKind === "playlist" && (
            options.playlists.length === 0 ? (
              <Notice>You don&apos;t have any playlists yet.</Notice>
            ) : (
              <div className="flex flex-col gap-2" role="group" aria-label="Your playlists">
                {options.playlists.map((p) => (
                  <Choice key={p.id} selected={s.playlistId === p.id} disabled={!p.eligible} onClick={() => { patch({ playlistId: p.id }); onPick({ title: p.title, thumbnailUrl: p.thumbnailUrl }); }}>
                    <Thumb url={p.thumbnailUrl}><ListMusic size={18} aria-hidden={true} /></Thumb>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-primary line-clamp-1 break-words">{p.title}</span>
                      <span className="block text-xs text-secondary">{p.eligible ? `${p.totalFiles} files` : p.reason}</span>
                    </span>
                  </Choice>
                ))}
              </div>
            )
          )}
          <FieldError msg={errors.fileId || errors.playlistId || errors.contentKind} />
        </div>
      )}

      {s.adType === "telegram_channel" && (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-secondary" role="group" aria-label="Channel source">
            {(["own", "external"] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={s.channelMode === m}
                onClick={() => { patch({ channelMode: m, channelId: null, destinationRef: "", inviteLink: "", objective: null }); onDestinationChange(); }}
                className={cn("min-h-10 rounded-lg text-sm font-semibold", s.channelMode === m ? "bg-card text-primary shadow-app-sm" : "text-secondary")}
              >
                {m === "own" ? "My channel" : "Another channel"}
              </button>
            ))}
          </div>
          {s.channelMode === "own" ? (
            options.channels.length === 0 ? (
              <Notice>You have no connected channels. Connect one in ME → Channel Management to promote it here.</Notice>
            ) : (
              <>
                <div className="flex flex-col gap-2" role="group" aria-label="Your connected channels">
                  {options.channels.map((c) => (
                    <Choice key={c.id} selected={s.channelId === c.id} onClick={() => { patch({ channelId: c.id, objective: null }); onDestinationChange(); }}>
                      <Thumb url={null}><Send size={18} aria-hidden={true} /></Thumb>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-primary line-clamp-1 break-words">{c.name}</span>
                        <span className="block text-xs text-secondary">{c.isPrivate ? "Private channel" : `@${c.username}`}</span>
                      </span>
                    </Choice>
                  ))}
                </div>
                {selectedChannel?.isPrivate && (
                  <div>
                    <Label htmlFor="ad-invite" hint="people join through this link">Invite link</Label>
                    <input id="ad-invite" className="input-app" inputMode="url" autoCapitalize="none" autoCorrect="off" placeholder="https://t.me/+AbCdEf…" maxLength={200} value={s.inviteLink} onChange={(e) => { patch({ inviteLink: e.target.value }); onDestinationChange(); }} />
                    <p className="text-xs text-muted mt-1.5">Private channels can only be joined through an invite link you create in Telegram.</p>
                    <FieldError msg={errors.inviteLink} />
                  </div>
                )}
              </>
            )
          ) : (
            <div>
              <Label htmlFor="ad-channel-ref" hint="public channels only">Channel</Label>
              <input id="ad-channel-ref" className="input-app" autoCapitalize="none" autoCorrect="off" placeholder="@channelname or t.me/channelname" maxLength={200} value={s.destinationRef} onChange={(e) => { patch({ destinationRef: e.target.value }); onDestinationChange(); }} />
              <FieldError msg={errors.destinationRef} />
            </div>
          )}
          <FieldError msg={errors.channelId} />
        </div>
      )}

      {s.adType === "telegram_post" && (
        <div>
          <Label htmlFor="ad-post-ref" hint="public channel post">Post link</Label>
          <input id="ad-post-ref" className="input-app" autoCapitalize="none" autoCorrect="off" placeholder="https://t.me/channelname/123" maxLength={300} value={s.destinationRef} onChange={(e) => { patch({ destinationRef: e.target.value }); onDestinationChange(); }} />
          <FieldError msg={errors.destinationRef} />
        </div>
      )}

      {needsVerify && (s.channelMode === "external" || s.adType === "telegram_post" || s.channelId) && (
        <div className="flex flex-col gap-2">
          <button type="button" onClick={onVerify} disabled={resolving || (s.adType === "telegram_channel" && s.channelMode === "own" && !!selectedChannel?.isPrivate && !s.inviteLink.trim())} className="btn-secondary min-h-11 text-sm inline-flex items-center justify-center gap-2 disabled:opacity-60">
            {resolving ? <Loader2 size={16} className="animate-spin" aria-hidden={true} /> : <ShieldCheck size={16} aria-hidden={true} />}
            {resolving ? "Checking with Telegram…" : resolved ? "Check again" : "Check destination"}
          </button>
          {resolveError && <p role="alert" className="text-xs text-red-500 break-words">{resolveError}</p>}
          {resolved && (
            <div className="rounded-xl p-3 status-completed text-xs flex gap-2 break-words" data-testid="destination-verified">
              <CheckCircle2 size={15} className="flex-shrink-0 mt-0.5" aria-hidden={true} />
              <div className="min-w-0">
                <p className="font-semibold">{resolved.label}</p>
                <p className="mt-0.5">
                  {resolved.ownership === "own" ? "Verified as yours." : "Found on Telegram. Ownership isn't verified — Onfile reviews every external destination before it runs."}
                </p>
              </div>
            </div>
          )}
          <p className="text-xs text-muted">A link alone doesn&apos;t prove ownership or permission to advertise. Onfile checks it with Telegram and an administrator reviews your campaign.</p>
        </div>
      )}
    </div>
  );
}

// ─── Step 2 — objective ──────────────────────────────────────────────────────
export function StepObjective({ s, patch, errors, resolved }: StepProps & { resolved: ResolvedInfo | null }) {
  if (!s.adType) return null;
  const allowed = OBJECTIVES_BY_TYPE[s.adType];
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-secondary mb-1">Only goals Onfile can actually measure for this campaign are shown.</p>
      {allowed.map((o) => {
        const info = OBJECTIVE_INFO[o];
        const blocked = o === "verified_joins" && !resolved?.joinVerifiable;
        return (
          <div key={o}>
            <Choice selected={s.objective === o} disabled={blocked} onClick={() => patch({ objective: o })}>
              <span className="min-w-0">
                <span className="block text-sm font-bold text-primary">{info.label}</span>
                <span className="block text-xs text-secondary">{info.description}</span>
              </span>
            </Choice>
            {blocked && (
              <p className="text-xs text-muted mt-1.5 px-1 break-words">
                {resolved?.joinNote ?? "Check your destination in step 1 first. Verified joins need Onfile's bot to be an administrator of the channel."}
              </p>
            )}
          </div>
        );
      })}
      <FieldError msg={errors.objective} />
      <Notice>
        An impression is not a click, and a click is not a join. Verified joins are only counted for people who were <b>not</b> members when they tapped Join and are confirmed by Telegram afterwards.
      </Notice>
    </div>
  );
}

// ─── Step 3 — creative ───────────────────────────────────────────────────────
export function StepCreative({ s, patch, errors, picked, resolved }: StepProps & { picked: PickedItem | null; resolved: ResolvedInfo | null }) {
  const label = picked?.title ?? resolved?.label ?? null;
  return (
    <div className="flex flex-col gap-4">
      <div>
        <Label htmlFor="ad-title" hint="only you see this">Campaign title</Label>
        <input id="ad-title" className="input-app" maxLength={LIMITS.titleMax} value={s.title} onChange={(e) => patch({ title: e.target.value })} placeholder="e.g. Spring launch" />
        <FieldError msg={errors.title} />
      </div>
      <div>
        <Label htmlFor="ad-headline"><span>Headline</span> <span className="text-muted font-normal">({s.headline.length}/{LIMITS.headlineMax})</span></Label>
        <input id="ad-headline" className="input-app" maxLength={LIMITS.headlineMax} value={s.headline} onChange={(e) => patch({ headline: e.target.value })} placeholder={label ?? "What are you promoting?"} />
        {!s.headline && label && (
          <button type="button" className="text-xs text-brand font-semibold mt-1.5" onClick={() => patch({ headline: label.slice(0, LIMITS.headlineMax) })}>
            Use “{label.slice(0, 40)}{label.length > 40 ? "…" : ""}”
          </button>
        )}
        <FieldError msg={errors.headline} />
      </div>
      <div>
        <Label htmlFor="ad-desc"><span>Short description</span> <span className="text-muted font-normal">({s.description.length}/{LIMITS.descriptionMax})</span></Label>
        <textarea id="ad-desc" className="input-app resize-none" rows={3} maxLength={LIMITS.descriptionMax} value={s.description} onChange={(e) => patch({ description: e.target.value })} placeholder="One or two short sentences." />
        {!s.description && resolved?.suggestedDescription && (
          <button type="button" className="text-xs text-brand font-semibold mt-1.5" onClick={() => patch({ description: resolved.suggestedDescription ?? "" })}>
            Use the description from your content
          </button>
        )}
        <FieldError msg={errors.description} />
      </div>
      <div>
        <Label htmlFor="ad-cta" hint={`${s.ctaText.length}/${LIMITS.ctaMax}`}>Button text</Label>
        <input id="ad-cta" className="input-app" maxLength={LIMITS.ctaMax} value={s.ctaText} onChange={(e) => patch({ ctaText: e.target.value })} placeholder="Open" />
        <FieldError msg={errors.ctaText} />
      </div>
      <p className="text-xs text-muted">Plain text only — HTML and scripts aren&apos;t allowed. {s.adType === "onfile_content" ? "The thumbnail comes from your file or playlist." : "Telegram destinations show an icon; custom images aren't supported."}</p>
      <div>
        <p className="text-xs font-semibold text-secondary mb-1.5">Live preview</p>
        <AdPreview adType={s.adType} contentKind={s.contentKind} headline={s.headline} description={s.description} ctaText={s.ctaText} thumbnailUrl={picked?.thumbnailUrl ?? null} label={s.adType === "onfile_content" ? null : label} />
      </div>
    </div>
  );
}

// ─── Step 4 — placements ─────────────────────────────────────────────────────
export function StepPlacements({ s, patch, errors, options, resolved }: StepProps & { options: WizardOptions; resolved: ResolvedInfo | null }) {
  const defs: PlacementDefinition[] = s.adType ? placementsForType(s.adType) : [];
  const gateSelected = s.placements.includes("force_join");
  // Force join is only sellable when it can be measured: verified-joins objective + a channel the bot can read.
  const forceJoinBlock =
    s.objective !== "verified_joins" ? "Choose the “Verified Channel Joins” objective in step 2 to use force join."
    : !resolved?.joinVerifiable ? resolved?.joinNote ?? "Onfile's bot must be an administrator of the channel to verify membership."
    : null;
  const toggle = (key: string) => {
    if (key === "force_join") return patch({ placements: gateSelected ? [] : ["force_join"], fileId: null });
    // Optional placements and the membership gate never mix.
    const base = gateSelected ? [] : s.placements;
    patch({ placements: base.includes(key) ? base.filter((p) => p !== key) : [...base, key] });
  };
  const gateFiles = options.files.filter((f) => f.eligible);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-secondary mb-1">Choose where your ad can appear. Only placements Onfile has actually built can be selected.</p>
      {defs.map((p) => (
        <div key={p.key}>
          <Choice selected={s.placements.includes(p.key)} disabled={!p.available || (p.key === "force_join" && !!forceJoinBlock && !gateSelected)} onClick={() => toggle(p.key)} label={p.label}>
            <span className={cn("w-5 h-5 rounded-md border flex items-center justify-center flex-shrink-0", s.placements.includes(p.key) ? "bg-[#FF6115] border-[#FF6115] text-white" : "border-app")} aria-hidden={true}>
              {s.placements.includes(p.key) && <CheckCircle2 size={14} />}
            </span>
            <span className="min-w-0">
              <span className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-bold text-primary">{p.label}</span>
                {!p.available && <span className="chip bg-secondary text-muted">Not available yet</span>}
              </span>
              <span className="block text-xs text-secondary">{p.available ? p.description : p.unavailableReason}</span>
            </span>
          </Choice>
          {p.key === "force_join" && forceJoinBlock && !gateSelected && <p className="text-xs text-muted mt-1.5 px-1 break-words">{forceJoinBlock}</p>}
          {p.key === "force_join" && gateSelected && (
            <div className="mt-2 rounded-xl border border-app bg-secondary p-3 flex flex-col gap-2">
              <Label htmlFor="gate-file" hint="Only this file is gated. Nothing else in Onfile is affected.">File visitors must join to unlock</Label>
              <select
                id="gate-file"
                className="input-app text-sm"
                value={s.fileId ?? ""}
                onChange={(e) => patch({ fileId: e.target.value ? Number(e.target.value) : null })}
                aria-invalid={!!errors.gateFileId}
              >
                <option value="">Select one of your published files…</option>
                {gateFiles.map((f) => <option key={f.id} value={f.id}>{f.title}</option>)}
              </select>
              {gateFiles.length === 0 && <p className="text-xs text-muted">You have no published files yet.</p>}
              <FieldError msg={errors.gateFileId} />
            </div>
          )}
        </div>
      ))}
      <FieldError msg={errors.placements} />
      <Notice>
        <b>Channel join</b> is optional: people see a card and may tap Join. <b>Force join</b> is mandatory: the gated file only unlocks after Telegram confirms the viewer is a channel member. A tap on Join never counts as a join, and existing members are never counted.
      </Notice>
    </div>
  );
}

// ─── Step 5 — audience ───────────────────────────────────────────────────────
function ChipSelect({ items, selected, onToggle, label }: { items: { code: string; label: string }[]; selected: string[]; onToggle: (code: string) => void; label: string }) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label={label}>
      {items.map((i) => {
        const on = selected.includes(i.code);
        return (
          <button key={i.code} type="button" aria-pressed={on} onClick={() => onToggle(i.code)} className={cn("min-h-9 px-3 rounded-full border text-xs font-semibold", on ? "border-[#FF6115] bg-brand-10 text-brand" : "border-app bg-card text-secondary")}>
            {i.label}
          </button>
        );
      })}
    </div>
  );
}

export function StepAudience({ s, patch, errors, options }: StepProps & { options: WizardOptions }) {
  const flip = (list: string[], code: string) => (list.includes(code) ? list.filter((c) => c !== code) : [...list, code]);
  return (
    <div className="flex flex-col gap-5">
      <Notice>
        Leave both lists empty to show your ad to everyone. A targeted ad is only shown when the viewer&apos;s country/language is <b>known</b> and selected — Onfile never guesses. No personal data is collected for targeting.
      </Notice>
      <div>
        <p className="text-sm font-bold text-primary mb-0.5">Countries <span className="text-xs text-muted font-normal">({s.countries.length || "all"})</span></p>
        <p className="text-xs text-secondary mb-2">Based on the visitor&apos;s network location, when available.</p>
        <ChipSelect items={options.countries} selected={s.countries} onToggle={(c) => patch({ countries: flip(s.countries, c) })} label="Countries" />
        <FieldError msg={errors.countries} />
      </div>
      <div>
        <p className="text-sm font-bold text-primary mb-0.5">Languages <span className="text-xs text-muted font-normal">({s.languages.length || "all"})</span></p>
        <p className="text-xs text-secondary mb-2">Based on the language saved in a signed-in viewer&apos;s Onfile profile.</p>
        <ChipSelect items={options.languages} selected={s.languages} onToggle={(c) => patch({ languages: flip(s.languages, c) })} label="Languages" />
        <FieldError msg={errors.languages} />
      </div>
      <p className="text-xs text-muted">Device / platform targeting isn&apos;t offered because Onfile can&apos;t detect it reliably.</p>
    </div>
  );
}

// ─── Step 6 — budget & duration ──────────────────────────────────────────────
export function StepBudget({ s, patch, errors }: StepProps) {
  const today = todayIso();
  const days = daysBetween(s.startDate, s.endDate);
  const unit = s.objective ? OBJECTIVE_INFO[s.objective] : null;
  const setDuration = (n: number) => {
    const start = s.startDate && s.startDate >= today ? s.startDate : today;
    patch({ startDate: start, endDate: addDaysIso(start, n - 1) });
  };
  return (
    <div className="flex flex-col gap-4">
      <div>
        <Label htmlFor="ad-budget" hint="USD · your maximum spend">Total budget</Label>
        <input id="ad-budget" className="input-app" inputMode="decimal" placeholder="25.00" value={s.budget} onChange={(e) => patch({ budget: e.target.value.replace(/[^\d.]/g, "").slice(0, 10) })} />
        <FieldError msg={errors.budget} />
      </div>
      <div>
        <p className="text-xs font-semibold text-secondary mb-1.5">Duration</p>
        <div className="flex gap-2 flex-wrap mb-3">
          {[7, 14, 30].map((n) => (
            <button key={n} type="button" onClick={() => setDuration(n)} className={cn("min-h-9 px-3 rounded-full border text-xs font-semibold", days === n ? "border-[#FF6115] bg-brand-10 text-brand" : "border-app bg-card text-secondary")}>
              {n} days
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="min-w-0">
            <Label htmlFor="ad-start">Start date</Label>
            <input id="ad-start" type="date" className="input-app" min={today} value={s.startDate} onChange={(e) => patch({ startDate: e.target.value })} />
            <FieldError msg={errors.startDate} />
          </div>
          <div className="min-w-0">
            <Label htmlFor="ad-end">End date</Label>
            <input id="ad-end" type="date" className="input-app" min={s.startDate || today} value={s.endDate} onChange={(e) => patch({ endDate: e.target.value })} />
            <FieldError msg={errors.endDate} />
          </div>
        </div>
      </div>
      <div>
        <Label htmlFor="ad-target" hint={unit ? `optional · ${unit.unit}` : "optional"}>Campaign target</Label>
        <input id="ad-target" className="input-app" inputMode="numeric" placeholder={unit ? `e.g. 1000 ${unit.unit}` : "e.g. 1000"} value={s.targetAmount} onChange={(e) => patch({ targetAmount: e.target.value.replace(/\D/g, "").slice(0, 9) })} />
        <p className="text-xs text-muted mt-1.5">The campaign completes automatically when it reaches this target.</p>
        <FieldError msg={errors.targetAmount} />
      </div>
      <CostSummary s={s} />
    </div>
  );
}

function Row({ k, v, strong }: { k: string; v: React.ReactNode; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-3 py-1.5 text-sm">
      <span className="text-secondary flex-shrink-0">{k}</span>
      <span className={cn("text-right min-w-0 break-words", strong ? "font-bold text-primary" : "text-primary")}>{v}</span>
    </div>
  );
}

export function CostSummary({ s }: { s: WizardState }) {
  const budget = Number(s.budget);
  const days = daysBetween(s.startDate, s.endDate);
  const model = s.objective ? OBJECTIVE_INFO[s.objective].pricingModel : null;
  return (
    <div className="bg-card border border-app rounded-2xl p-3" data-testid="cost-summary">
      <p className="text-sm font-bold text-primary mb-1">Cost summary</p>
      <div className="divide-y divide-[var(--color-border-light)]">
        <Row k="Maximum spend" v={s.budget && Number.isFinite(budget) ? formatMoney(budget) : "—"} strong />
        <Row k="Duration" v={days ? `${days} day${days === 1 ? "" : "s"}` : "—"} />
        <Row k="Pricing" v={model ? `Set by Onfile · ${PRICING_MODEL_LABELS[model]}` : "Pending admin confirmation"} />
        <Row k="Payment" v={PAYMENT_STATUS_LABELS.pending_confirmation} />
      </div>
      <p className="text-xs text-muted mt-2 leading-relaxed">{PRICING_NOTICE}</p>
    </div>
  );
}

// ─── Step 7 — review ─────────────────────────────────────────────────────────
function Section({ title, step, onEdit, children }: { title: string; step: StepIndex; onEdit: (s: StepIndex) => void; children: React.ReactNode }) {
  return (
    <section className="bg-card border border-app rounded-2xl p-3 min-w-0">
      <div className="flex items-center justify-between gap-2 mb-1">
        <h3 className="text-sm font-bold text-primary">{title}</h3>
        <button type="button" onClick={() => onEdit(step)} className="text-xs font-semibold text-brand min-h-9 px-2" aria-label={`Edit ${title}`}>Edit</button>
      </div>
      <div className="divide-y divide-[var(--color-border-light)]">{children}</div>
    </section>
  );
}

export function StepReview({ s, errors, onEdit, picked, resolved, options }: { s: WizardState; errors: Errors; onEdit: (s: StepIndex) => void; picked: PickedItem | null; resolved: ResolvedInfo | null; options: WizardOptions }) {
  const objective = s.objective ? OBJECTIVE_INFO[s.objective] : null;
  const destination =
    s.adType === "onfile_content" ? picked?.title ?? (s.contentKind === "file" ? options.files.find((f) => f.id === s.fileId)?.title : options.playlists.find((p) => p.id === s.playlistId)?.title) ?? "—"
    : resolved?.label ?? (s.channelId ? options.channels.find((c) => c.id === s.channelId)?.name : s.destinationRef) ?? "—";
  const placementLabels = s.placements.map((k) => PLACEMENTS.find((p) => p.key === k)?.label ?? k).join(", ") || "—";
  const countryLabels = s.countries.map((c) => options.countries.find((o) => o.code === c)?.label ?? c).join(", ");
  const languageLabels = s.languages.map((c) => options.languages.find((o) => o.code === c)?.label ?? c).join(", ");
  const days = daysBetween(s.startDate, s.endDate);
  const errorList = Object.values(errors);
  return (
    <div className="flex flex-col gap-3">
      {errorList.length > 0 && (
        <div role="alert" className="status-rejected rounded-xl p-3 text-xs break-words">
          <p className="font-semibold mb-1">Fix these before submitting:</p>
          <ul className="list-disc pl-4">{[...new Set(errorList)].map((e) => <li key={e}>{e}</li>)}</ul>
        </div>
      )}
      <Section title="Campaign" step={0} onEdit={onEdit}>
        <Row k="Type" v={s.adType ? AD_TYPE_INFO[s.adType].label : "—"} />
        <Row k="Destination" v={destination} />
        {resolved && <Row k="Ownership" v={resolved.ownership === "own" ? "Verified as yours" : "External — admin review"} />}
      </Section>
      <Section title="Objective" step={1} onEdit={onEdit}>
        <Row k="Goal" v={objective?.label ?? "—"} />
      </Section>
      <Section title="Creative" step={2} onEdit={onEdit}>
        <Row k="Title" v={s.title || "—"} />
        <div className="pt-2">
          <AdPreview adType={s.adType} contentKind={s.contentKind} headline={s.headline} description={s.description} ctaText={s.ctaText} thumbnailUrl={picked?.thumbnailUrl ?? null} />
        </div>
      </Section>
      <Section title="Placements" step={3} onEdit={onEdit}>
        <Row k="Shown in" v={placementLabels} />
        {s.placements.includes("force_join") && <Row k="Gated file" v={options.files.find((f) => f.id === s.fileId)?.title ?? "—"} />}
      </Section>
      <Section title="Audience" step={4} onEdit={onEdit}>
        <Row k="Countries" v={countryLabels || "Everyone"} />
        <Row k="Languages" v={languageLabels || "Everyone"} />
      </Section>
      <Section title="Budget & schedule" step={5} onEdit={onEdit}>
        <Row k="Maximum spend" v={s.budget ? formatMoney(Number(s.budget)) : "—"} strong />
        <Row k="Dates" v={s.startDate && s.endDate ? `${s.startDate} → ${s.endDate}${days ? ` (${days}d)` : ""}` : "—"} />
        <Row k="Target" v={s.targetAmount && objective ? `${Number(s.targetAmount).toLocaleString("en-US")} ${objective.unit}` : "None"} />
        <Row k="Payment" v={PAYMENT_STATUS_LABELS.pending_confirmation} />
      </Section>
      <Notice>
        Submitting sends your campaign to Onfile for <b>review</b>. It is <b>not live</b> until an administrator approves it, confirms pricing and payment. Nothing is charged from your wallet.
      </Notice>
    </div>
  );
}
