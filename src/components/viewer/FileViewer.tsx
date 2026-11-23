"use client";
import React from "react";
import { ShieldCheck } from "lucide-react";
import FileHero from "@/components/download/FileHero";
import CreatorRow from "@/components/download/CreatorRow";
import ActionRow from "@/components/viewer/ActionRow";
import DescriptionBlock from "@/components/viewer/DescriptionBlock";
import PlaylistList from "@/components/viewer/PlaylistList";
import SavedItemsWidget from "@/components/viewer/SavedItemsWidget";
import { useSavedItems } from "@/lib/useSavedItems";
import { formatNumber } from "@/lib/utils";
import type { DownloadCreatorInfo, DownloadFileInfo } from "@/lib/download";
import type { PublicPlaylistItem } from "@/lib/playlistSharing";
import { playlistSummary, typeAndSize } from "@/lib/viewer";
import SponsoredSlot from "@/components/ads/SponsoredSlot";

export interface ViewerPlaylist {
  /** Public share token (the existing /p/<token> route). */
  slug: string;
  title: string;
  items: PublicPlaylistItem[];
  selectedSlug: string;
  onSelect: (slug: string) => void;
}

/**
 * The unified viewer used by both the playlist route (/p/<token>) and the standalone file route (/f/<slug>).
 *
 * Order, top to bottom: selected thumbnail → title → uploader (photo + display name only) → playlist line
 * (playlist mode only) → file facts → short description → action row → playlist list (playlist mode only).
 * No logo, no navigation menu, no Previous/Next.
 */
export default function FileViewer({
  file,
  creator,
  playlist,
  detailLoading = false,
}: {
  file: DownloadFileInfo;
  creator: DownloadCreatorInfo | null;
  playlist?: ViewerPlaylist;
  /** True while the selected file's description/stats are still being fetched (playlist mode). */
  detailLoading?: boolean;
}) {
  const saved = useSavedItems();
  const { rememberLastFile } = saved;
  const playlistSlug = playlist?.slug;

  // Keep a saved playlist pointing at the file the visitor is on. This only updates an EXISTING entry.
  React.useEffect(() => {
    if (playlistSlug) rememberLastFile(playlistSlug, file.slug);
  }, [playlistSlug, file.slug, rememberLastFile]);

  const facts = [typeAndSize(file), file.views != null ? `${formatNumber(file.views)} views` : "", file.downloads != null ? `${formatNumber(file.downloads)} downloads` : ""].filter(Boolean);
  const actionPlaylist = playlist
    ? { slug: playlist.slug, title: playlist.title, thumbnailUrl: playlist.items[0]?.thumbnailUrl ?? null }
    : undefined;

  return (
    <div className="min-h-screen bg-app" data-testid="file-viewer" data-mode={playlist ? "playlist" : "file"}>
      <div className="mx-auto w-full max-w-2xl px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[calc(env(safe-area-inset-bottom)+5rem)] flex flex-col gap-5 overflow-x-hidden">
        <main className="flex flex-col gap-3.5 min-w-0">
          <p className="sr-only" role="status" aria-live="polite">Showing {file.title}</p>

          <FileHero file={playlist ? { ...file, thumbnailWidth: null, thumbnailHeight: null } : file} fixedRatio={!!playlist} />

          <h1 className="text-2xl font-bold text-primary leading-tight break-words" data-testid="file-title">{file.title}</h1>

          <CreatorRow creator={creator} />

          {playlist && (
            <p className="text-sm font-semibold text-secondary" data-testid="playlist-meta">{playlistSummary(playlist.items)}</p>
          )}

          {facts.length > 0 && <p className="text-xs text-muted -mt-1 break-words" data-testid="file-facts">{facts.join(" · ")}</p>}

          <DescriptionBlock key={`description-${file.slug}`} text={file.description} loading={detailLoading} />

          <ActionRow key={`actions-${file.slug}`} file={file} playlist={actionPlaylist} />

          <SponsoredSlot slot="file_access" />
        </main>

        {playlist && <PlaylistList playlistSlug={playlist.slug} items={playlist.items} selectedSlug={playlist.selectedSlug} onSelect={playlist.onSelect} />}

        <footer className="flex items-center justify-center gap-1.5 text-xs text-muted pt-1 text-center">
          <ShieldCheck size={13} aria-hidden="true" className="flex-shrink-0" />
          Delivered through Telegram · Onfile doesn’t store your files
        </footer>
      </div>
      <SavedItemsWidget />
    </div>
  );
}
