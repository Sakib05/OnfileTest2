"use client";
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { SkipBack, SkipForward, ListVideo } from "lucide-react";
import { cn } from "@/lib/utils";
import { itemHref, neighbours, rememberPosition, type PublicPlaylistPayload } from "@/lib/playlistSharing";

/**
 * Playlist context for the existing file page: "3 of 12", Previous / Next and Back to playlist.
 *
 * The list is read from the PUBLIC playlist API (which enforces publishing / password / price rules), and the
 * current position is found by matching the file's slug — the `i` query value is never trusted. If the playlist
 * is missing, private, locked or doesn't contain this file, the bar renders nothing and the file page behaves
 * exactly as before. Files are delivered through Telegram, so Previous/Next simply open the neighbouring file's
 * page in saved order; nothing auto-plays.
 */
export default function PlaylistNavBar({ listSlug, fileSlug }: { listSlug: string; fileSlug: string }) {
  const [data, setData] = useState<PublicPlaylistPayload | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/p/${encodeURIComponent(listSlug)}`, { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as PublicPlaylistPayload;
        if (!cancelled) setData(body);
      } catch {
        /* no playlist context — plain file page */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [listSlug]);

  const nav = data && !data.playlist.locked ? neighbours(data.items, fileSlug) : null;

  useEffect(() => {
    if (nav) rememberPosition(listSlug, nav.position);
  }, [listSlug, nav]);

  if (!data || !nav) return null;

  const arrow = "w-11 h-11 inline-flex items-center justify-center rounded-xl border border-app bg-secondary text-primary";
  return (
    <nav aria-label="Playlist navigation" data-testid="playlist-nav" className="flex items-center gap-2 rounded-2xl border border-app bg-card p-2 shadow-app-sm">
      <Link href={`/p/${encodeURIComponent(listSlug)}`} className="min-w-0 flex-1 flex items-center gap-2 min-h-11 px-2 rounded-xl" data-testid="playlist-nav-back" aria-label={`Back to playlist ${data.playlist.title}`}>
        <ListVideo size={18} className="text-brand flex-shrink-0" aria-hidden="true" />
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-primary truncate">{data.playlist.title}</span>
          <span className="block text-xs text-secondary" data-testid="playlist-nav-position" aria-live="polite">
            {nav.position} of {nav.total}
          </span>
        </span>
      </Link>
      {nav.previous ? (
        <Link href={itemHref(nav.previous.slug, listSlug, nav.previous.position)} replace className={arrow} aria-label={`Previous: ${nav.previous.title}`} data-testid="playlist-nav-prev">
          <SkipBack size={20} aria-hidden="true" />
        </Link>
      ) : (
        <span className={cn(arrow, "opacity-40")} aria-disabled="true" data-testid="playlist-nav-prev-disabled"><SkipBack size={20} aria-hidden="true" /></span>
      )}
      {nav.next ? (
        <Link href={itemHref(nav.next.slug, listSlug, nav.next.position)} replace className={arrow} aria-label={`Next: ${nav.next.title}`} data-testid="playlist-nav-next">
          <SkipForward size={20} aria-hidden="true" />
        </Link>
      ) : (
        <span className={cn(arrow, "opacity-40")} aria-disabled="true" data-testid="playlist-nav-next-disabled"><SkipForward size={20} aria-hidden="true" /></span>
      )}
    </nav>
  );
}
