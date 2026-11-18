"use client";
import React, { useId, useState } from "react";
import { Check, Info, Loader2, Lock, Star } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils";
import { PLAYLIST_PASSWORD_MAX, PLAYLIST_TITLE_MAX } from "@/lib/playlists";
import { STARS_MAX, STARS_MIN } from "@/lib/publishing/constants";
import { JSON_HEADERS, readJson } from "./types";

export interface SettingsResult {
  title?: string;
  hasPassword: boolean;
  starsPrice: number;
  /** Raw server payload (`playlist` or `file`) for callers that want to merge more fields. */
  raw: Record<string, unknown>;
}

/**
 * Access / monetization settings for a playlist OR one file — both use the EXISTING PATCH endpoints and the
 * existing fields only (password, Stars price). Nothing about pricing, payment verification or ads is
 * decided here. Password and Stars are independent switches (as they already are in the data model), so
 * saving never silently drops one of them; both off = free access.
 */
export default function SettingsForm({
  kind,
  id,
  initial,
  withTitle = false,
  onSaved,
}: {
  kind: "playlist" | "file";
  id: number;
  initial: { title: string; hasPassword: boolean; starsPrice: number };
  withTitle?: boolean;
  onSaved: (r: SettingsResult) => void;
}) {
  const { toast } = useToast();
  const uid = useId();
  const [title, setTitle] = useState(initial.title);
  const [passwordOn, setPasswordOn] = useState(initial.hasPassword);
  const [password, setPassword] = useState("");
  const [starsOn, setStarsOn] = useState(initial.starsPrice > 0);
  const [stars, setStars] = useState(initial.starsPrice > 0 ? String(initial.starsPrice) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const titleChanged = withTitle && title.trim() !== initial.title;
  const passwordChange: "set" | "clear" | null = passwordOn ? (password ? "set" : null) : initial.hasPassword ? "clear" : null;
  const starsValue = starsOn ? Number(stars) : 0;
  const starsChanged = starsValue !== initial.starsPrice;
  const dirty = titleChanged || passwordChange !== null || starsChanged;
  const free = !passwordOn && !starsOn;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving || !dirty) return;
    const body: Record<string, unknown> = {};
    if (withTitle) {
      const t = title.trim();
      if (!t) return setError("Title is required.");
      if (t.length > PLAYLIST_TITLE_MAX) return setError(`Title must be ${PLAYLIST_TITLE_MAX} characters or fewer.`);
      if (titleChanged) body.title = t;
    }
    if (passwordOn && !initial.hasPassword && !password) return setError("Enter a password, or switch password protection off.");
    if (password.length > PLAYLIST_PASSWORD_MAX) return setError(`Password must be ${PLAYLIST_PASSWORD_MAX} characters or fewer.`);
    if (passwordChange === "set") body.password = password;
    if (passwordChange === "clear") body.password = null;
    if (starsOn) {
      if (!/^\d{1,5}$/.test(stars.trim()) || starsValue < STARS_MIN || starsValue > STARS_MAX) return setError(`Enter a whole number of Stars from ${STARS_MIN} to ${STARS_MAX.toLocaleString("en-US")}.`);
    }
    if (starsChanged) body.starsPrice = starsValue;

    setError(null);
    setSaving(true);
    try {
      const res = await fetch(kind === "playlist" ? `/api/playlists/${id}` : `/api/files/${id}`, { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify(body) });
      const data = await readJson(res);
      const row = (kind === "playlist" ? data?.playlist : data?.file) as Record<string, unknown> | undefined;
      if (!res.ok || !row) {
        setError(String(data?.error ?? "Couldn't save your changes. Please try again."));
        return;
      }
      const hasPassword = kind === "playlist" ? !!row.hasPassword : !!row.password;
      toast("Settings saved");
      onSaved({ title: typeof row.title === "string" ? row.title : undefined, hasPassword, starsPrice: Number(row.starsPrice ?? 0), raw: row });
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      {withTitle && (
        <div>
          <label htmlFor={`${uid}-title`} className="text-xs font-semibold text-secondary mb-1.5 block">Title</label>
          <input id={`${uid}-title`} className="input-app" value={title} maxLength={PLAYLIST_TITLE_MAX} onChange={(e) => setTitle(e.target.value)} />
        </div>
      )}

      <div className="rounded-2xl border border-app bg-card p-3.5 flex flex-col gap-3">
        <Switch id={`${uid}-pw`} checked={passwordOn} onChange={setPasswordOn} icon={<Lock size={16} aria-hidden="true" />} label="Password protection" hint="Visitors must enter a password to open it." />
        {passwordOn && (
          <div>
            <label htmlFor={`${uid}-pw-input`} className="text-xs font-semibold text-secondary mb-1.5 block">
              {initial.hasPassword ? "New password (leave blank to keep the current one)" : "Password"}
            </label>
            <input
              id={`${uid}-pw-input`}
              className="input-app"
              type="password"
              autoComplete="new-password"
              value={password}
              maxLength={PLAYLIST_PASSWORD_MAX}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={initial.hasPassword ? "••••••••" : "Choose a password"}
            />
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-app bg-card p-3.5 flex flex-col gap-3">
        <Switch id={`${uid}-stars`} checked={starsOn} onChange={setStarsOn} icon={<Star size={16} aria-hidden="true" />} label="Telegram Stars price" hint="Visitors pay in Telegram Stars." />
        {starsOn && (
          <div>
            <label htmlFor={`${uid}-stars-input`} className="text-xs font-semibold text-secondary mb-1.5 block">Price in Stars</label>
            <input id={`${uid}-stars-input`} className="input-app" inputMode="numeric" value={stars} onChange={(e) => setStars(e.target.value.replace(/[^\d]/g, "").slice(0, 5))} placeholder={`${STARS_MIN}–${STARS_MAX.toLocaleString("en-US")}`} />
            {kind === "playlist" && (
              <p className="mt-2 flex gap-1.5 text-xs text-secondary">
                <Info size={13} className="flex-shrink-0 mt-0.5" aria-hidden="true" />
                <span>A playlist with a Stars price can&apos;t be shared yet — Telegram Stars payments aren&apos;t connected, so its public link stays unavailable.</span>
              </p>
            )}
          </div>
        )}
      </div>

      <p className="text-xs text-secondary" data-testid="access-summary">
        Current access: <span className="font-semibold text-primary">{free ? "Free access" : [passwordOn && "Password", starsOn && "Stars"].filter(Boolean).join(" + ")}</span>
      </p>

      {error && <p role="alert" className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 rounded-xl px-3 py-2">{error}</p>}
      <button type="submit" disabled={saving || !dirty} className="btn-primary w-full min-h-11 py-3 text-sm flex items-center justify-center gap-2 disabled:opacity-60">
        {saving ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Check size={15} aria-hidden="true" />} {saving ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}

function Switch({ id, checked, onChange, icon, label, hint }: { id: string; checked: boolean; onChange: (v: boolean) => void; icon: React.ReactNode; label: string; hint: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-9 h-9 rounded-xl bg-secondary text-secondary flex items-center justify-center flex-shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="block text-sm font-semibold text-primary">{label}</label>
        <p className="text-xs text-secondary">{hint}</p>
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative w-12 h-7 rounded-full flex-shrink-0 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]",
          checked ? "bg-[var(--color-primary)]" : "bg-[var(--color-border)]"
        )}
      >
        <span className={cn("absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-[#fff] shadow transition-transform", checked && "translate-x-5")} />
      </button>
    </div>
  );
}
