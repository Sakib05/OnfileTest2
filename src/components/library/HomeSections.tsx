"use client";
import React from "react";
import { ChevronRight } from "lucide-react";
import { hasMore, type HomeSection } from "@/lib/library";
import { FileCard, PlaylistCard } from "./LibraryCards";
import type { FileItem, PlaylistItem } from "./types";

interface Handlers {
  onOpenFile: (f: FileItem) => void;
  onMenuFile: (f: FileItem, a: DOMRect) => void;
  onOpenPlaylist: (p: PlaylistItem) => void;
  onMenuPlaylist: (p: PlaylistItem, a: DOMRect) => void;
  onSeeAll: (section: HomeSection<FileItem | PlaylistItem>) => void;
}

/**
 * The organised Library home: one titled, horizontally scrollable row per
 * non-empty category. Rows hold at most HOME_ROW_LIMIT cards; "See all"
 * appears only when there is more to show.
 */
export default function HomeSections({ sections, ...h }: { sections: HomeSection<FileItem | PlaylistItem>[] } & Handlers) {
  return (
    <div className="flex flex-col gap-6" data-testid="home-sections">
      {sections.map((section) => (
        <section key={section.key} aria-labelledby={`home-sec-${section.key}`} data-testid={`home-section-${section.key}`}>
          <div className="flex items-center justify-between mb-2.5 gap-3">
            <h2 id={`home-sec-${section.key}`} className="text-base font-bold text-primary flex items-baseline gap-2 min-w-0">
              <span className="truncate">{section.title}</span>
              <span className="text-xs font-medium text-muted">{section.total}</span>
            </h2>
            {hasMore(section) && (
              <button
                type="button"
                onClick={() => h.onSeeAll(section)}
                aria-label={`See all ${section.title}`}
                className="flex-shrink-0 inline-flex items-center gap-0.5 min-h-10 pl-3 -mr-1 text-xs font-semibold text-brand"
              >
                See all
                <ChevronRight size={14} />
              </button>
            )}
          </div>
          {/* Bleeds to the screen edges so the next card peeks in, signalling the row scrolls. */}
          <div
            className="flex gap-3 overflow-x-auto no-scrollbar snap-x -mx-4 px-4 pb-1"
            style={{ scrollPaddingInline: 16, WebkitOverflowScrolling: "touch" }}
          >
            {section.items.map((item) =>
              section.kind === "playlist" ? (
                <PlaylistCard key={`pl-${item.id}`} playlist={item as PlaylistItem} layout="row" onOpen={h.onOpenPlaylist} onMenu={h.onMenuPlaylist} />
              ) : (
                <FileCard key={`f-${item.id}`} file={item as FileItem} layout="row" onOpen={h.onOpenFile} onMenu={h.onMenuFile} />
              )
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
