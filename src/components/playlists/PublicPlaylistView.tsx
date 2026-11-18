"use client";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Lock, SearchX, Star, WifiOff } from "lucide-react";
import CreatorRow from "@/components/download/CreatorRow";
import PlaylistThumb from "@/components/ui/PlaylistThumb";
import FileViewer from "@/components/viewer/FileViewer";
import SavedItemsWidget from "@/components/viewer/SavedItemsWidget";
import { ViewerFrame, ViewerMessage, ViewerSkeleton } from "@/components/viewer/ViewerMessage";
import type { DownloadFileInfo } from "@/lib/download";
import type { PublicPlaylistPayload } from "@/lib/playlistSharing";
import { getTelegramWebApp } from "@/lib/telegramWebApp";
import { useTelegramBackButton } from "@/lib/useTelegramBackButton";
import { parseFileParam, resolveSelected, selectionUrl } from "@/lib/viewer";

type Load = { name: "loading" } | { name: "ready"; data: PublicPlaylistPayload } | { name: "not_found" } | { name: "error" };

/** Public details of ONE file (GET /api/link/<slug>): description + stats. Authorisation is unchanged and server-side. */
interface FileDetail {
  description: string | null;
  views: number | null;
  downloads: number | null;
}

/**
 * Unified public playlist page (route: /p/<token>). One page, two parts:
 *   top    — the SELECTED file (thumbnail, title, uploader, description, Get File / Save / Share / Report)
 *   bottom — the playlist's file list
 * Clicking a file only changes the selection: the top section updates in place, the URL becomes /p/<token>?f=<file slug>
 * (history.pushState — no navigation, no reload), refresh restores it and Back/Forward walk through earlier selections.
 *
 * Authorisation never depends on this selection: the playlist payload only contains files the server decided the
 * visitor may see (published, unlocked playlist), an unknown `?f=` falls back to the first item, and Get File still
 * asks the server to authorise that file's own password / advertisement / price rules.
 */
export default function PublicPlaylistView({ slug }: { slug: string }) {
  const router = useRouter();
  const [load, setLoad] = useState<Load>({ name: "loading" });
  const [password, setPassword] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState("");
  /** `?f=` as last read from the address bar. The effective selection is derived from it (see resolveSelected). */
  const [wanted, setWanted] = useState<string | null>(() => (typeof window === "undefined" ? null : parseFileParam(window.location.search)));
  const [details, setDetails] = useState<Record<string, FileDetail | null>>({});

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

  // Browser Back / Forward: re-read the address bar.
  useEffect(() => {
    const onPop = () => setWanted(parseFileParam(window.location.search));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

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

  const items = useMemo(() => (load.name === "ready" ? load.data.items : []), [load]);
  const selected = useMemo(() => resolveSelected(items, wanted), [items, wanted]);
  const selectedSlug = selected?.slug ?? null;
  const haveDetail = selectedSlug ? selectedSlug in details : true;

  // Load description + stats of the selected file once (cached per file for this visit).
  useEffect(() => {
    if (!selectedSlug || haveDetail) return;
    const ac = new AbortController();
    (async () => {
      try {
        const res = await fetch(`/api/link/${encodeURIComponent(selectedSlug)}`, { signal: ac.signal });
        const data = res.ok ? ((await res.json()) as { file?: { description?: string | null; views?: number | null; downloads?: number | null } }) : null;
        setDetails((d) => ({
          ...d,
          [selectedSlug]: data?.file ? { description: data.file.description ?? null, views: data.file.views ?? null, downloads: data.file.downloads ?? null } : null,
        }));
      } catch {
        /* aborted (selection changed) or offline: the description simply stays hidden */
      }
    })();
    return () => ac.abort();
  }, [selectedSlug, haveDetail]);

  const onSelect = useCallback(
    (fileSlug: string) => {
      if (fileSlug !== selectedSlug) {
        window.history.pushState(null, "", selectionUrl(slug, fileSlug));
        setWanted(fileSlug);
      }
      // The selected-file section is at the top: bring it into view.
      try {
        window.scrollTo({ top: 0, behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      } catch {
        /* non-browser environment */
      }
    },
    [slug, selectedSlug]
  );

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

  if (load.name === "loading") return <ViewerSkeleton label="Loading playlist" />;
  if (load.name === "not_found") {
    return (
      <ViewerMessage
        testId="public-playlist-message"
        icon={<SearchX size={34} />}
        title="Playlist not found"
        text="This link may have expired, or the creator made the playlist private."
        action={<Link href="/" className="btn-primary px-6 py-3 text-sm">Go to Onfile</Link>}
      />
    );
  }
  if (load.name === "error") {
    return (
      <ViewerMessage
        testId="public-playlist-message"
        icon={<WifiOff size={34} />}
        title="Couldn’t load this playlist"
        text="Check your connection and try again."
        action={<button type="button" onClick={() => { setLoad({ name: "loading" }); void fetchPlaylist(); }} className="btn-primary px-6 py-3 text-sm">Try again</button>}
      />
    );
  }

  const { playlist, creator } = load.data;

  // ── Locked playlists: only title + description until the server accepts the password ─────────────
  if (playlist.locked) {
    return (
      <>
        <ViewerFrame testId="public-playlist-page">
          <div className="relative w-full aspect-video rounded-3xl overflow-hidden bg-secondary border border-app shadow-app-md" data-testid="public-playlist-cover">
            <PlaylistThumb url={null} />
          </div>
          <div className="min-w-0 flex flex-col gap-3">
            <h1 className="text-2xl font-bold text-primary leading-tight break-words" data-testid="public-playlist-title">{playlist.title}</h1>
            <CreatorRow creator={creator} />
            {playlist.description && <p className="text-sm text-secondary whitespace-pre-wrap break-words" data-testid="public-playlist-description">{playlist.description}</p>}
          </div>

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
        </ViewerFrame>
        <SavedItemsWidget />
      </>
    );
  }

  if (!selected) {
    return (
      <>
        <ViewerFrame testId="public-playlist-page">
          <div className="text-center py-10 px-2 rounded-2xl border border-dashed border-app" data-testid="public-playlist-empty">
            <p className="text-sm font-semibold text-primary mb-1">{playlist.title}</p>
            <p className="text-sm text-secondary">The creator hasn&apos;t published any files in this playlist yet.</p>
          </div>
        </ViewerFrame>
        <SavedItemsWidget />
      </>
    );
  }

  const detail = details[selected.slug] ?? null;
  const file: DownloadFileInfo = {
    slug: selected.slug,
    title: selected.title,
    fileType: selected.fileType ?? "other",
    mimeType: selected.mimeType,
    fileSize: selected.fileSize,
    thumbnailUrl: selected.thumbnailUrl,
    hasPassword: selected.hasPassword,
    starsPrice: selected.starsPrice,
    description: detail?.description ?? null,
    views: detail?.views ?? undefined,
    downloads: detail?.downloads ?? undefined,
  };

  return (
    <FileViewer
      file={file}
      creator={creator}
      detailLoading={!haveDetail}
      playlist={{ slug, title: playlist.title, items, selectedSlug: selected.slug, onSelect }}
    />
  );
}
