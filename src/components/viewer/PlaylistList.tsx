"use client";
import React from "react";
import { Lock, Star } from "lucide-react";
import FileThumb from "@/components/ui/FileThumb";
import { cn } from "@/lib/utils";
import type { PublicPlaylistItem } from "@/lib/playlistSharing";
import { selectionUrl, typeAndSize } from "@/lib/viewer";

/**
 * The playlist's file list. Rows are real links (so "open in new tab" and copy-link still work) but a plain click
 * is intercepted: the selection changes in place — no page navigation, no reload.
 * There is intentionally no Previous / Next control and no Telegram button here.
 */
export default function PlaylistList({
  playlistSlug,
  items,
  selectedSlug,
  onSelect,
}: {
  playlistSlug: string;
  items: PublicPlaylistItem[];
  selectedSlug: string;
  onSelect: (slug: string) => void;
}) {
  return (
    <section aria-label="Playlist files">
      <ol className="flex flex-col gap-2" data-testid="playlist-list">
        {items.map((item) => {
          const selected = item.slug === selectedSlug;
          return (
            <li key={item.slug}>
              <a
                href={selectionUrl(playlistSlug, item.slug)}
                onClick={(e) => {
                  // Let the browser handle modified clicks (new tab / window / download).
                  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                  e.preventDefault();
                  onSelect(item.slug);
                }}
                aria-current={selected ? "true" : undefined}
                aria-label={`${item.title}${selected ? " (selected)" : ""}`}
                data-testid="playlist-item"
                data-selected={selected ? "true" : "false"}
                className={cn(
                  "flex items-center gap-3 p-2 rounded-xl border transition-colors min-w-0",
                  selected ? "border-[#FF6115] bg-brand-10" : "border-app bg-card hover:bg-secondary active:bg-secondary"
                )}
              >
                <span className="w-24 sm:w-28 aspect-video rounded-lg bg-secondary relative overflow-hidden flex-shrink-0 border border-app">
                  <FileThumb url={item.thumbnailUrl} fileType={item.fileType} title={item.title} mimeType={item.mimeType} />
                </span>
                <span className="min-w-0 flex-1 block">
                  <span className={cn("block text-sm font-semibold line-clamp-2 leading-snug break-words", selected ? "text-brand" : "text-primary")}>{item.title}</span>
                  <span className="mt-0.5 text-xs text-secondary flex items-center gap-x-1.5 gap-y-0.5 flex-wrap">
                    <span>{typeAndSize(item)}</span>
                    {item.hasPassword && <span className="chip bg-secondary text-secondary" aria-label="Password protected"><Lock size={10} aria-hidden="true" /></span>}
                    {item.starsPrice > 0 && <span className="chip bg-secondary text-secondary"><Star size={10} aria-hidden="true" /> {item.starsPrice}</span>}
                  </span>
                </span>
                {selected && <span className="w-2 h-2 rounded-full bg-brand flex-shrink-0 mr-1" aria-hidden="true" />}
              </a>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
