"use client";
import React, { useEffect, useRef, useState } from "react";
import { AlertCircle, Bookmark, Download, Eye, EyeOff, Flag, Loader2, Lock, Share2 } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import SuccessPanel from "@/components/download/SuccessPanel";
import ReportDialog from "@/components/viewer/ReportDialog";
import { AD_SECONDS, confirmDelivered, getUnlockMethods, requestUnlock, type DownloadFileInfo } from "@/lib/download";
import { buildShareUrl } from "@/lib/playlistSharing";
import { canNativeShare, copyText, nativeShare } from "@/lib/playlistShareClient";
import { useSavedItems } from "@/lib/useSavedItems";
import { fileShareUrl } from "@/lib/viewer";
import { cn } from "@/lib/utils";

export interface ActionPlaylist {
  slug: string;
  title: string;
  thumbnailUrl: string | null;
}

const SECONDARY =
  "h-[52px] w-full rounded-2xl border border-app bg-secondary text-primary inline-flex items-center justify-center transition-colors hover:bg-card active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#FF6115]";

/**
 * The single horizontal action row: Get File (50%) · Save · Share · Report (16.67% each).
 *
 * Get File runs the EXISTING access flow unchanged — it only lost its advertisement card:
 *   - password files: password dialog → server verifies (POST /api/link/<slug>)
 *   - everything else: the existing advertisement step (AD_SECONDS countdown), then a second tap asks the server
 *     to authorise the file (POST /api/link/<slug>); only the server's answer reveals the Telegram delivery link.
 * Nothing here grants access by itself; a request in flight blocks repeats.
 *
 * Mount it with `key={file.slug}`: switching the selected file resets the access state of the previous one.
 */
export default function ActionRow({ file, playlist }: { file: DownloadFileInfo; playlist?: ActionPlaylist }) {
  const { toast } = useToast();
  const saved = useSavedItems();

  const methods = getUnlockMethods(file);
  const needsPassword = methods[0] === "password";

  const [remaining, setRemaining] = useState<number | null>(null); // null = ad not started, N>0 = seconds left, 0 = done
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState("");
  const [unlocked, setUnlocked] = useState<{ link: string | null; receipt?: string } | null>(null);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  useEffect(() => {
    if (remaining === null || remaining <= 0) return;
    const t = setTimeout(() => setRemaining((r) => (r === null ? r : r - 1)), 1000);
    return () => clearTimeout(t);
  }, [remaining]);

  const submit = async (pwd?: string): Promise<boolean> => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setError("");
    const result = await requestUnlock(file.slug, pwd, undefined, playlist?.slug);
    busyRef.current = false;
    setBusy(false);
    if (result.ok) {
      setUnlocked({ link: result.telegramMessageLink, receipt: result.receipt });
      return true;
    }
    setError(result.message);
    return false;
  };

  const adPlaying = remaining !== null && remaining > 0;
  const adDone = remaining === 0;
  const progress = remaining === null ? 0 : ((AD_SECONDS - remaining) / AD_SECONDS) * 100;

  const onGetFile = () => {
    if (busy || adPlaying || unlocked) return;
    setError("");
    if (needsPassword) return setPasswordOpen(true);
    if (remaining === null) return setRemaining(AD_SECONDS);
    if (adDone) void submit();
  };

  const onPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || busy) return;
    if (await submit(password)) {
      setPasswordOpen(false);
      setPassword("");
    }
  };

  // ── Save: a playlist is ONE entry (its token); a standalone file is one entry (its slug) ──────────
  const saveType = playlist ? "playlist" : "file";
  const saveId = playlist ? playlist.slug : file.slug;
  const isSaved = saved.isSaved(saveType, saveId);

  const onSave = () => {
    if (isSaved) {
      if (saved.remove(saveType, saveId)) toast(playlist ? "Playlist removed from saved items" : "File removed from saved items", "info");
      return;
    }
    const ok = playlist
      ? saved.save({ type: "playlist", id: playlist.slug, title: playlist.title, thumbnailUrl: playlist.thumbnailUrl, lastFile: file.slug })
      : saved.save({ type: "file", id: file.slug, title: file.title, thumbnailUrl: file.thumbnailUrl });
    toast(ok ? (playlist ? "Playlist saved on this device" : "File saved on this device") : "Couldn't save — browser storage isn't available.", ok ? "success" : "error");
  };

  // ── Share: the playlist's public link in playlist mode, the existing /f/<slug> link otherwise ─────
  const onShare = async () => {
    const url = playlist ? buildShareUrl(window.location.origin, playlist.slug) : fileShareUrl(window.location.origin, file.slug);
    const title = playlist ? playlist.title : file.title;
    if (canNativeShare()) {
      const r = await nativeShare({ title, url });
      if (r === "failed") toast("Couldn't open the share sheet.", "error");
      return;
    }
    const ok = await copyText(url);
    toast(ok ? (playlist ? "Playlist link copied" : "Link copied") : "Couldn't copy the link.", ok ? "success" : "error");
  };

  const label = adPlaying ? `Wait ${remaining}s` : "Get File";
  const hasStars = (file.starsPrice ?? 0) > 0;

  return (
    <div className="flex flex-col gap-3" data-testid="action-area">
      <div className="grid grid-cols-6 gap-2" data-testid="action-row">
        <button
          type="button"
          onClick={onGetFile}
          disabled={busy || adPlaying || !!unlocked}
          aria-busy={busy}
          data-testid="get-file"
          className="btn-cta col-span-3 relative overflow-hidden !px-3 !rounded-2xl whitespace-nowrap"
        >
          {busy ? <Loader2 size={18} className="animate-spin flex-shrink-0" aria-hidden="true" /> : adPlaying ? null : <Download size={18} className="flex-shrink-0" aria-hidden="true" />}
          <span className="truncate">{busy ? "Preparing…" : label}</span>
          {adPlaying && (
            <span
              className="absolute bottom-0 left-0 right-0 h-1 bg-[rgba(0,0,0,0.2)]"
              role="progressbar"
              aria-label="Advertisement progress"
              aria-valuemin={0}
              aria-valuemax={AD_SECONDS}
              aria-valuenow={AD_SECONDS - (remaining ?? 0)}
            >
              <span className="block h-full bg-[rgba(255,255,255,0.9)] transition-[width] duration-1000 ease-linear" style={{ width: `${progress}%` }} />
            </span>
          )}
        </button>

        <button type="button" onClick={onSave} aria-pressed={isSaved} aria-label={isSaved ? (playlist ? "Playlist saved. Tap to remove" : "Saved. Tap to remove") : playlist ? "Save playlist" : "Save"} title={isSaved ? "Saved" : "Save"} data-testid="save" className={cn(SECONDARY, isSaved && "text-brand border-[#FF6115]")}>
          <Bookmark size={20} aria-hidden="true" fill={isSaved ? "currentColor" : "none"} />
        </button>
        <button type="button" onClick={() => void onShare()} aria-label={playlist ? "Share playlist" : "Share"} title="Share" data-testid="share" className={SECONDARY}>
          <Share2 size={20} aria-hidden="true" />
        </button>
        <button type="button" onClick={() => setReportOpen(true)} aria-label="Report" title="Report" aria-haspopup="dialog" data-testid="report" className={SECONDARY}>
          <Flag size={20} aria-hidden="true" />
        </button>
      </div>

      {/* One quiet status line (not a card): ad progress, completion hint, Stars note */}
      <div aria-live="polite" className="text-xs text-secondary text-center empty:hidden">
        {adPlaying && <span data-testid="ad-status">Advertisement in progress… {remaining}s</span>}
        {adDone && !unlocked && !busy && <span data-testid="ad-status">Advertisement completed. Tap Get File to continue.</span>}
      </div>

      {error && !passwordOpen && (
        <div id="unlock-error" role="alert" className="flex items-start gap-2 p-3 rounded-xl bg-red-50 dark:bg-red-900/20">
          <AlertCircle size={15} className="text-red-500 mt-px flex-shrink-0" aria-hidden="true" />
          <p className="text-xs text-red-600 dark:text-red-400 leading-snug">{error}</p>
        </div>
      )}

      {unlocked && (
        <SuccessPanel
          telegramMessageLink={unlocked.link}
          onOpen={unlocked.receipt ? () => confirmDelivered(file.slug, unlocked.receipt!) : undefined}
        />
      )}

      {hasStars && !unlocked && (
        <p className="text-xs text-secondary text-center" data-testid="stars-note">
          ⭐ {file.starsPrice} Stars listed. Telegram Stars checkout isn’t available yet — nothing is charged.
        </p>
      )}

      {passwordOpen && (
        <Modal open onClose={() => { if (!busy) { setPasswordOpen(false); setError(""); } }} title="Password protected" size="sm">
          <form className="flex flex-col gap-4" onSubmit={onPasswordSubmit}>
            <div className="flex items-start gap-3">
              <span className="w-11 h-11 rounded-2xl bg-brand-10 flex items-center justify-center flex-shrink-0"><Lock size={20} className="text-brand" aria-hidden="true" /></span>
              <p className="text-xs text-secondary mt-0.5 min-w-0">Enter the password from the creator to get this file.</p>
            </div>
            <div className="relative">
              <label htmlFor="file-password" className="sr-only">File password</label>
              <input
                id="file-password"
                className={cn("input-app text-sm pr-12", error && "border-red-500")}
                type={showPassword ? "text" : "password"}
                placeholder="Enter password"
                autoComplete="off"
                autoFocus
                value={password}
                disabled={busy}
                aria-invalid={!!error}
                aria-describedby={error ? "password-error" : undefined}
                onChange={(e) => { setPassword(e.target.value); if (error) setError(""); }}
              />
              <button type="button" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? "Hide password" : "Show password"} className="absolute right-1 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center text-muted hover:text-primary">
                {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
              </button>
            </div>
            {error && (
              <div id="password-error" role="alert" className="flex items-start gap-2 p-3 rounded-xl bg-red-50 dark:bg-red-900/20">
                <AlertCircle size={15} className="text-red-500 mt-px flex-shrink-0" aria-hidden="true" />
                <p className="text-xs text-red-600 dark:text-red-400 leading-snug">{error}</p>
              </div>
            )}
            <button type="submit" className="btn-cta" disabled={busy || !password} aria-busy={busy}>
              {busy ? <Loader2 size={18} className="animate-spin" aria-hidden="true" /> : <Lock size={18} aria-hidden="true" />}
              {busy ? "Verifying…" : "Unlock file"}
            </button>
          </form>
        </Modal>
      )}

      {reportOpen && (
        <ReportDialog
          onClose={() => setReportOpen(false)}
          file={{ slug: file.slug, title: file.title }}
          playlist={playlist ? { slug: playlist.slug, title: playlist.title } : undefined}
        />
      )}
    </div>
  );
}
