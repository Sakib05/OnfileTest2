"use client";
import React, { useEffect, useRef, useState } from "react";
import { AlertCircle, Check, CheckCircle2, Download, Eye, EyeOff, Loader2, Lock, Play, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  AD_SECONDS, getUnlockMethods, requestUnlock,
  type DownloadFileInfo, type UnlockMethod,
} from "@/lib/download";

const METHOD_META: Record<UnlockMethod, { label: string; icon: typeof Play }> = {
  ad: { label: "Watch ad", icon: Play },
  password: { label: "Password", icon: Lock },
  stars: { label: "Stars", icon: Star },
};

/**
 * The primary action area of the file page.
 *
 * Every route to the file goes through `requestUnlock` → POST /api/link/[slug];
 * the server decides (password check) and only its successful answer reveals the
 * Telegram link. Clicking a button never grants access by itself, and a request
 * already in flight blocks further clicks (no accidental repeats).
 */
export default function UnlockPanel({
  slug,
  file,
  onUnlocked,
}: {
  slug: string;
  file: DownloadFileInfo;
  onUnlocked: (telegramMessageLink: string | null) => void;
}) {
  const methods = getUnlockMethods(file);
  const [method, setMethod] = useState<UnlockMethod>(methods[0]);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState("");

  // Ad step: null = not started, N>0 = seconds left, 0 = completed.
  const [remaining, setRemaining] = useState<number | null>(null);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (remaining === null || remaining <= 0) return;
    const t = setTimeout(() => setRemaining((r) => (r === null ? r : r - 1)), 1000);
    return () => clearTimeout(t);
  }, [remaining]);

  const submit = async (pwd?: string) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    const result = await requestUnlock(slug, pwd);
    if (result.ok) {
      onUnlocked(result.telegramMessageLink);
    } else {
      setError(result.message);
    }
    busyRef.current = false;
    setBusy(false);
  };

  const adDone = remaining === 0;
  const adPlaying = remaining !== null && remaining > 0;
  const progress = remaining === null ? 0 : ((AD_SECONDS - remaining) / AD_SECONDS) * 100;

  return (
    <section aria-label="Get this file" className="rounded-3xl border border-app bg-card p-4 sm:p-5 flex flex-col gap-4 shadow-app-sm">
      {methods.length > 1 && (
        <div role="tablist" aria-label="Access method" className="grid gap-1 p-1 rounded-2xl bg-secondary" style={{ gridTemplateColumns: `repeat(${methods.length}, minmax(0, 1fr))` }}>
          {methods.map((m) => {
            const { label, icon: Icon } = METHOD_META[m];
            const active = method === m;
            return (
              <button
                key={m}
                role="tab"
                type="button"
                aria-selected={active}
                disabled={busy}
                onClick={() => { setMethod(m); setError(""); }}
                className={cn(
                  "h-10 rounded-xl text-[13px] font-semibold inline-flex items-center justify-center gap-1.5 transition-colors",
                  active ? "bg-card text-primary shadow-app-sm" : "text-secondary hover:text-primary"
                )}
              >
                <Icon size={14} className={active ? "text-brand" : undefined} />
                {label}
              </button>
            );
          })}
        </div>
      )}

      {/* ── Advertisement ─────────────────────────────────────────────── */}
      {method === "ad" && (
        <div className="flex flex-col gap-4">
          <ol className="flex items-center gap-2 text-xs font-semibold" aria-label="Steps">
            <Step n={1} label="Watch a short ad" state={adDone ? "done" : "active"} />
            <span className="h-px flex-1 bg-[var(--color-border)]" aria-hidden="true" />
            <Step n={2} label="Get your file" state={adDone ? "active" : "idle"} />
          </ol>

          <div
            className="relative h-36 rounded-2xl border border-app bg-secondary flex flex-col items-center justify-center gap-1.5 text-center overflow-hidden px-4"
            aria-live="polite"
          >
            {adDone ? (
              <>
                <CheckCircle2 size={34} className="text-green-500" />
                <p className="font-semibold text-primary text-sm">Ad completed</p>
                <p className="text-xs text-secondary">Tap “Get file” to continue</p>
              </>
            ) : adPlaying ? (
              <>
                <span className="absolute top-3 left-3 text-[10px] font-bold tracking-wider uppercase text-muted">Advertisement</span>
                <span className="absolute top-2.5 right-3 min-w-8 h-8 px-2 rounded-full bg-card border border-app flex items-center justify-center text-sm font-bold text-primary" aria-label={`${remaining} seconds left`}>
                  {remaining}
                </span>
                <p className="font-bold text-primary">Ad space</p>
                <p className="text-xs text-secondary">Powered by Adsgram</p>
                <div
                  className="absolute bottom-0 left-0 right-0 h-1 bg-[var(--color-border)]"
                  role="progressbar"
                  aria-label="Ad progress"
                  aria-valuemin={0}
                  aria-valuemax={AD_SECONDS}
                  aria-valuenow={AD_SECONDS - (remaining ?? 0)}
                >
                  <div className="h-full bg-brand transition-[width] duration-1000 ease-linear" style={{ width: `${progress}%` }} />
                </div>
              </>
            ) : (
              <>
                <span className="w-12 h-12 rounded-full bg-brand-10 flex items-center justify-center"><Play size={20} className="text-brand" /></span>
                <p className="font-semibold text-primary text-sm">Watch a {AD_SECONDS}-second ad to unlock</p>
                <p className="text-xs text-secondary">Free access after one short ad</p>
              </>
            )}
          </div>

          {remaining === null && (
            <button type="button" className="btn-cta" onClick={() => { setError(""); setRemaining(AD_SECONDS); }}>
              <Play size={18} />
              Watch ad to get file
            </button>
          )}
          {adPlaying && (
            <button type="button" className="btn-cta" disabled aria-disabled="true">
              <Loader2 size={18} className="animate-spin" />
              Please wait… {remaining}s
            </button>
          )}
          {adDone && (
            <button type="button" className="btn-cta" disabled={busy} aria-busy={busy} onClick={() => void submit()}>
              {busy ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
              {busy ? "Preparing your file…" : "Get file"}
            </button>
          )}
        </div>
      )}

      {/* ── Password ──────────────────────────────────────────────────── */}
      {method === "password" && (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (password) void submit(password);
          }}
        >
          <div className="flex items-start gap-3">
            <span className="w-11 h-11 rounded-2xl bg-brand-10 flex items-center justify-center flex-shrink-0"><Lock size={20} className="text-brand" /></span>
            <div className="min-w-0">
              <p className="font-semibold text-primary text-sm">Password protected</p>
              <p className="text-xs text-secondary mt-0.5">Enter the password from the creator to get this file.</p>
            </div>
          </div>
          <div className="relative">
            <label htmlFor="file-password" className="sr-only">File password</label>
            <input
              id="file-password"
              className={cn("input-app text-sm pr-12", error && "border-red-500")}
              type={showPassword ? "text" : "password"}
              placeholder="Enter password"
              autoComplete="off"
              value={password}
              disabled={busy}
              aria-invalid={!!error}
              aria-describedby={error ? "unlock-error" : undefined}
              onChange={(e) => { setPassword(e.target.value); if (error) setError(""); }}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="absolute right-1 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center text-muted hover:text-primary"
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          <button type="submit" className="btn-cta" disabled={busy || !password} aria-busy={busy}>
            {busy ? <Loader2 size={18} className="animate-spin" /> : <Lock size={18} />}
            {busy ? "Verifying…" : "Unlock file"}
          </button>
        </form>
      )}

      {/* ── Telegram Stars ────────────────────────────────────────────── */}
      {method === "stars" && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-app bg-secondary p-4">
            <div className="min-w-0">
              <p className="font-semibold text-primary text-sm">Instant, ad-free access</p>
              <p className="text-xs text-secondary mt-0.5">≈ ${((file.starsPrice ?? 0) * 0.013).toFixed(2)} USD</p>
            </div>
            <p className="text-xl font-black text-yellow-600 dark:text-yellow-400 whitespace-nowrap">⭐ {file.starsPrice}</p>
          </div>
          <button type="button" className="btn-cta" disabled aria-disabled="true">
            <Star size={18} />
            Pay {file.starsPrice} Stars
          </button>
          <p className="text-xs text-secondary text-center">
            Telegram Stars checkout isn’t available yet. Nothing is charged — use another option to get this file.
          </p>
        </div>
      )}

      {error && (
        <div id="unlock-error" role="alert" className="flex items-start gap-2 p-3 rounded-xl bg-red-50 dark:bg-red-900/20">
          <AlertCircle size={15} className="text-red-500 mt-px flex-shrink-0" />
          <p className="text-xs text-red-600 dark:text-red-400 leading-snug">{error}</p>
        </div>
      )}
    </section>
  );
}

function Step({ n, label, state }: { n: number; label: string; state: "idle" | "active" | "done" }) {
  return (
    <li className="flex items-center gap-2 min-w-0" aria-current={state === "active" ? "step" : undefined}>
      <span
        className={cn(
          "w-6 h-6 rounded-full flex items-center justify-center text-[11px] flex-shrink-0 transition-colors",
          state === "idle" && "bg-secondary text-muted",
          state === "active" && "bg-brand text-white",
          state === "done" && "bg-green-500 text-white"
        )}
      >
        {state === "done" ? <Check size={13} strokeWidth={3} /> : n}
      </span>
      <span className={cn("truncate", state === "idle" ? "text-muted" : "text-primary")}>{label}</span>
    </li>
  );
}
