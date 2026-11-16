"use client";
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Lock, Play, RotateCcw, SearchX, Share2, ShieldCheck, Star, WifiOff } from "lucide-react";
import CreatorRow from "@/components/download/CreatorRow";
import FileThumb from "@/components/ui/FileThumb";
import PlaylistThumb from "@/components/ui/PlaylistThumb";
import { useToast } from "@/components/ui/Toast";
import { fileKindLabel } from "@/lib/fileKinds";
import { buildShareUrl, itemHref, recallPosition, type PublicPlaylistPayload } from "@/lib/playlistSharing";
import { canNativeShare, copyText, nativeShare } from "@/lib/playlistShareClient";
import { getTelegramWebApp } from "@/lib/telegramWebApp";
import { useTelegramBackButton } from "@/lib/useTelegramBackButton";
import { formatBytes } from "@/lib/utils";

type Load = { name: "loading" } | { name: "ready"; data: PublicPlaylistPayload } | { name: "not_found" } | { name: "error" };

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-app" data-testid="public-playlist-page">
      <div className="mx-auto w-full max-w-2xl px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[calc(env(safe-area-inset-bottom)+2rem)] flex flex-col gap-5">
        <header className="flex items-center">
          <Link href="/" className="flex items-center gap-2 min-h-10" aria-label="Onfile home">
            <span className="w-8 h-8 rounded-[10px] bg-brand flex items-center justify-center text-white text-sm font-black">O</span>
            <span className="font-bold text-primary text-base tracking-tight">Onfile</span>
          </Link>
        </header>
        {children}
      </div>
    </div>
  );
}

function Message({ icon, title, text, action }: { icon: React.ReactNode; title: string; text: string; action?: React.ReactNode }) {
  return (
    <Shell>
      <div className="flex flex-col items-center justify-center gap-4 text-center py-16 px-4" data-testid="public-playlist-message">
        <div className="w-20 h-20 rounded-3xl bg-secondary border border-app flex items-center justify-center text-muted">{icon}</div>
        <div>
          <h1 className="text-xl font-bold text-primary mb-1">{title}</h1>
          <p className="text-sm text-secondary">{text}</p>
        </div>
        {action}
      </div>
    </Shell>
  );
}

/**
 * Public, recipient-facing playlist page. Read-only: no edit / delete / reorder / membership controls and no
 * owner data — the API never sends any. Items are real links into the existing /f/<slug> file page, so each
 * file's own password / price rules still apply, and the playlist context (?list=…&i=…) enables Previous / Next.
 */
export default function PublicPlaylistView({ slug }: { slug: string }) {
  const { toast } = useToast();
  const router = useRouter();
  const [load, setLoad] = useState<Load>({ name: "loading" });
  const [password, setPassword] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState("");
  const [continueAt, setContinueAt] = useState<number | null>(null);

  const fetchPlaylist = useCallback(async () => {
    try {
      const res = await fetch(`/api/p/${encodeURIComponent(slug)}`, { cache: "no-store" });
      if (res.status === 404) return setLoad({ name: "not_found" });
      if (!res.ok) return setLoad({ name: "error" });
      setLoad({ name: "ready", data: (await res.json()) as PublicPlaylistPayload });
    } catch {
      setLoad({ name: "error" });
    }
  }, [slug]);

  useEffect(() => {
    // Initial load of the public playlist (network → state).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchPlaylist();
  }, [fetchPlaylist]);

  useEffect(() => {
    // Last opened item on THIS device (localStorage; read after mount to stay SSR-safe).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setContinueAt(recallPosition(slug));
  }, [slug]);

  // Telegram browser / Mini App: tell Telegram we're ready, use the full height, and wire the native Back button.
  useEffect(() => {
    const tg = getTelegramWebApp();
    try {
      tg?.ready();
      tg?.expand();
    } catch {
      /* not inside Telegram */
    }
  }, []);
  useTelegramBackButton(() => {
    if (window.history.length > 1) router.back();
    else router.replace("/");
  });

  const unlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (unlocking || !password) return;
    setUnlocking(true);
    setUnlockError("");
    try {
      const res = await fetch(`/api/p/${encodeURIComponent(slug)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      if (res.ok) {
        setPassword("");
        await fetchPlaylist();
      } else if (res.status === 429) {
        setUnlockError("Too many attempts. Please try again shortly.");
      } else if (res.status === 403) {
        setUnlockError("Incorrect password. Please try again.");
      } else {
        setUnlockError("Something went wrong. Please try again.");
      }
    } catch {
      setUnlockError("Network error. Please try again.");
    } finally {
      setUnlocking(false);
    }
  };

  if (load.name === "loading") {
    return (
      <Shell>
        <div className="flex flex-col gap-5 animate-pulse-brand" aria-busy="true" aria-label="Loading playlist" role="status">
          <div className="w-full aspect-video rounded-2xl bg-secondary border border-app" />
          <div className="h-7 w-2/3 rounded-lg bg-secondary" />
          <div className="h-4 w-1/2 rounded-lg bg-secondary" />
          {[1, 2, 3].map((i) => <div key={i} className="h-20 rounded-xl bg-secondary border border-app" />)}
        </div>
      </Shell>
    );
  }
  if (load.name === "not_found") {
    return (
      <Message
        icon={<SearchX size={34} />}
        title="Playlist not found"
        text="This link may have expired, or the creator made the playlist private."
        action={<Link href="/" className="btn-primary px-6 py-3 text-sm">Go to Onfile</Link>}
      />
    );
  }
  if (load.name === "error") {
    return (
      <Message
        icon={<WifiOff size={34} />}
        title="Couldn’t load this playlist"
        text="Check your connection and try again."
        action={<button type="button" onClick={() => { setLoad({ name: "loading" }); void fetchPlaylist(); }} className="btn-primary px-6 py-3 text-sm">Try again</button>}
      />
    );
  }

  const { playlist, creator, items } = load.data;
  const first = items[0];
  const resume = continueAt && continueAt > 1 ? (items.find((i) => i.position === continueAt) ?? null) : null;

  const share = async () => {
    const url = buildShareUrl(window.location.origin, slug);
    if (canNativeShare()) {
      const r = await nativeShare({ title: playlist.title, url });
      if (r === "failed") toast("Couldn't open the share sheet.", "error");
      return;
    }
    const ok = await copyText(url);
    toast(ok ? "Playlist link copied" : "Couldn't copy the link.", ok ? "success" : "error");
  };

  return (
    <Shell>
      <main className="flex flex-col gap-5">
        <section className="flex flex-col gap-4" aria-label="Playlist details">
          <div className="relative w-full aspect-video rounded-2xl overflow-hidden bg-secondary border border-app shadow-app-md" data-testid="public-playlist-cover">
            <PlaylistThumb url={playlist.thumbnailUrl} />
          </div>
          <div className="min-w-0 flex flex-col gap-3">
            <div>
              <h1 className="text-2xl font-bold text-primary leading-tight break-words" data-testid="public-playlist-title">{playlist.title}</h1>
              {playlist.description && (
                <p className="text-sm text-secondary whitespace-pre-wrap break-words mt-1.5" data-testid="public-playlist-description">{playlist.description}</p>
              )}
            </div>
            {!playlist.locked && (
              <p className="text-xs font-semibold text-secondary" data-testid="public-playlist-count">
                {playlist.itemCount} {playlist.itemCount === 1 ? "file" : "files"}
              </p>
            )}
            <CreatorRow creator={creator} className="rounded-2xl border border-app bg-card p-3" />

            {!playlist.locked && first && (
              <div className="flex items-center gap-2" data-testid="public-playlist-actions">
                <Link href={itemHref(first.slug, slug, first.position)} className="btn-primary flex-1 min-h-11 px-4 text-sm flex items-center justify-center gap-2" data-testid="public-play">
                  <Play size={16} aria-hidden="true" /> Play first
                </Link>
                {resume && (
                  <Link href={itemHref(resume.slug, slug, resume.position)} className="min-h-11 px-4 rounded-xl text-sm font-semibold inline-flex items-center justify-center gap-2 border border-app bg-secondary text-primary" data-testid="public-continue">
                    <RotateCcw size={15} aria-hidden="true" /> Continue ({resume.position})
                  </Link>
                )}
                <button type="button" onClick={() => void share()} aria-label="Share playlist" data-testid="public-share" className="w-11 h-11 flex-shrink-0 inline-flex items-center justify-center rounded-xl border border-app bg-secondary text-primary">
                  <Share2 size={17} aria-hidden="true" />
                </button>
              </div>
            )}
          </div>
        </section>

        {playlist.locked === "password" && (
          <form onSubmit={unlock} className="rounded-2xl border border-app bg-card p-4 flex flex-col gap-3 shadow-app-sm" data-testid="public-playlist-locked">
            <div className="flex items-start gap-3">
              <span className="w-11 h-11 rounded-2xl bg-brand-10 flex items-center justify-center flex-shrink-0"><Lock size={20} className="text-brand" /></span>
              <div className="min-w-0">
                <p className="font-semibold text-primary text-sm">Password protected</p>
                <p className="text-xs text-secondary mt-0.5">Enter the password from the creator to see this playlist.</p>
              </div>
            </div>
            <label htmlFor="pl-unlock" className="sr-only">Playlist password</label>
            <input id="pl-unlock" type="password" className="input-app" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" placeholder="Password" />
            {unlockError && <p role="alert" className="text-xs text-red-500">{unlockError}</p>}
            <button type="submit" disabled={unlocking || !password} className="btn-primary min-h-11 text-sm flex items-center justify-center gap-2 disabled:opacity-60">
              {unlocking && <Loader2 size={15} className="animate-spin" />} Unlock playlist
            </button>
          </form>
        )}

        {playlist.locked === "stars" && (
          <div className="rounded-2xl border border-app bg-card p-4 flex items-start gap-3" data-testid="public-playlist-paid">
            <span className="w-11 h-11 rounded-2xl bg-brand-10 flex items-center justify-center flex-shrink-0"><Star size={20} className="text-brand" /></span>
            <div className="min-w-0">
              <p className="font-semibold text-primary text-sm">Paid playlist</p>
              <p className="text-xs text-secondary mt-0.5">This playlist needs a Telegram Stars payment, which isn&apos;t available yet. Its content stays locked.</p>
            </div>
          </div>
        )}

        {!playlist.locked && (
          <section aria-label="Playlist content">
            {items.length === 0 ? (
              <div className="text-center py-10 px-2 rounded-2xl border border-dashed border-app" data-testid="public-playlist-empty">
                <p className="text-sm font-semibold text-primary mb-1">Nothing to show yet</p>
                <p className="text-sm text-secondary">The creator hasn&apos;t published any files in this playlist.</p>
              </div>
            ) : (
              <ol className="flex flex-col gap-2" data-testid="public-playlist-items">
                {items.map((item) => (
                  <li key={item.slug}>
                    <Link
                      href={itemHref(item.slug, slug, item.position)}
                      className="flex items-center gap-3 p-2 rounded-xl border border-app bg-card active:bg-secondary transition-colors"
                      data-testid="public-playlist-item"
                      aria-label={`Open ${item.title}, ${item.position} of ${items.length}`}
                    >
                      <span className="w-5 flex-shrink-0 text-center text-xs font-semibold text-muted tabular-nums">{item.position}</span>
                      <span className="w-28 aspect-video rounded-lg bg-secondary relative overflow-hidden flex-shrink-0 border border-app">
                        <FileThumb url={item.thumbnailUrl} fileType={item.fileType} title={item.title} mimeType={item.mimeType} />
                      </span>
                      <span className="min-w-0 flex-1 block">
                        <span className="block text-sm font-semibold text-primary line-clamp-2 leading-snug">{item.title}</span>
                        <span className="mt-0.5 text-xs text-secondary flex items-center gap-x-1.5 gap-y-0.5 flex-wrap">
                          <span>{fileKindLabel(item)}</span>
                          {item.fileSize ? <span>· {formatBytes(item.fileSize)}</span> : null}
                          {item.hasPassword && <span className="chip bg-secondary text-secondary" aria-label="Password protected"><Lock size={10} aria-hidden="true" /></span>}
                          {item.starsPrice > 0 && <span className="chip bg-secondary text-secondary"><Star size={10} aria-hidden="true" /> {item.starsPrice}</span>}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </section>
        )}
      </main>

      <footer className="flex items-center justify-center gap-1.5 text-xs text-muted pt-2">
        <ShieldCheck size={13} /> Delivered through Telegram · Onfile doesn’t store your files
      </footer>
    </Shell>
  );
}
