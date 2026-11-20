"use client";
import React, { useEffect, useState } from "react";
import { BarChart3 } from "lucide-react";
import { formatNumber } from "@/lib/utils";

type State = { name: "loading" } | { name: "ready"; fileRequests: number } | { name: "error" };

/**
 * Compact analytics. Shows ONLY what the backend really records for a playlist (see /api/playlists/:id/stats):
 * file requests. It deliberately says what is not tracked instead of inventing views, downloads or earnings.
 * `refreshKey` re-reads the counter after membership changes (the sum covers the current member files).
 */
export default function PlaylistStats({ playlistId, refreshKey }: { playlistId: number; refreshKey: number }) {
  const [state, setState] = useState<State>({ name: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/playlists/${playlistId}/stats`, { cache: "no-store" });
        const data = (await res.json().catch(() => null)) as { stats?: { fileRequests?: number } } | null;
        if (cancelled) return;
        if (!res.ok || typeof data?.stats?.fileRequests !== "number") setState({ name: "error" });
        else setState({ name: "ready", fileRequests: data.stats.fileRequests });
      } catch {
        if (!cancelled) setState({ name: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [playlistId, refreshKey]);

  return (
    <section className="rounded-2xl border border-app bg-card p-3.5" aria-label="Analytics" data-testid="playlist-stats">
      <div className="flex items-center gap-3">
        <span className="w-9 h-9 rounded-xl bg-brand-10 text-brand flex items-center justify-center flex-shrink-0" aria-hidden="true">
          <BarChart3 size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-secondary">File requests</p>
          {state.name === "loading" && <p className="text-lg font-bold text-primary leading-tight" role="status" aria-label="Loading analytics">…</p>}
          {state.name === "ready" && <p className="text-lg font-bold text-primary leading-tight tabular-nums" data-testid="stat-file-requests">{formatNumber(state.fileRequests)}</p>}
          {state.name === "error" && <p className="text-sm text-secondary" role="status">Analytics are unavailable right now.</p>}
        </div>
      </div>
      <p className="text-[11px] leading-snug text-muted mt-2.5">
        Counts unlock requests for these files, including requests through their own links — not confirmed Telegram deliveries. Playlist views, confirmed downloads and earnings aren&apos;t tracked yet.
      </p>
    </section>
  );
}
