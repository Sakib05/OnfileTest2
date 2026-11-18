"use client";
import React from "react";
import { Eye, EyeOff, Globe, ImageIcon, ListPlus, Lock, MoreHorizontal, Share2, Star } from "lucide-react";
import ActionMenu, { type ActionMenuItem } from "@/components/ui/ActionMenu";
import PlaylistThumb from "@/components/ui/PlaylistThumb";
import { cn, formatBytes } from "@/lib/utils";
import type { FileSummary } from "@/lib/playlistManage";
import type { PlaylistSummary } from "./types";

const tileBase =
  "min-h-[3.75rem] sm:min-h-11 px-1 rounded-xl text-xs sm:text-sm font-semibold inline-flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 border disabled:opacity-60 active:scale-[0.98] transition-transform focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]";
const tile = cn(tileBase, "border-app bg-secondary text-primary");
const tilePrimary = cn(tileBase, "border-transparent bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-dark)] shadow-app-sm");

/**
 * Cover · info · the four primary actions (Add Files, Preview, Share, More).
 * Presentational only: every value comes from the loaded playlist / its files, nothing is invented.
 */
export default function PlaylistHero({
  playlist,
  summary,
  menuItems,
  disabled,
  previewing,
  onAddFiles,
  onPreview,
  onShare,
  onChangeCover,
}: {
  playlist: PlaylistSummary;
  summary: FileSummary;
  menuItems: ActionMenuItem[];
  disabled: boolean;
  previewing: boolean;
  onAddFiles: () => void;
  onPreview: () => void;
  onShare: () => void;
  onChangeCover: () => void;
}) {
  const { count, knownBytes, partial, unpublished } = summary;
  const isPublic = !!playlist.isPublished;

  return (
    <section className="flex flex-col sm:flex-row gap-4 sm:gap-6" aria-label="Playlist details">
      <div className="relative w-full sm:w-60 flex-shrink-0 aspect-video rounded-2xl overflow-hidden bg-secondary border border-app shadow-app-md" data-testid="playlist-cover">
        <PlaylistThumb url={playlist.thumbnailUrl} />
        <button
          type="button"
          onClick={onChangeCover}
          disabled={disabled}
          data-testid="change-cover"
          className="absolute right-2 bottom-2 min-h-10 px-3 rounded-full inline-flex items-center gap-1.5 text-xs font-semibold bg-[rgba(0,0,0,0.6)] text-white backdrop-blur-sm disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-white"
        >
          <ImageIcon size={14} aria-hidden="true" /> Change cover
        </button>
      </div>

      <div className="min-w-0 flex-1 flex flex-col gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-primary leading-tight break-words" data-testid="playlist-title">{playlist.title}</h1>
          {playlist.description ? (
            <p className="text-sm text-secondary whitespace-pre-wrap break-words mt-1.5 line-clamp-3" data-testid="playlist-description">{playlist.description}</p>
          ) : (
            <p className="text-sm text-muted mt-1.5" data-testid="playlist-description">No description</p>
          )}
        </div>

        <div className="flex items-center gap-x-2 gap-y-1.5 flex-wrap text-xs text-secondary" data-testid="playlist-meta">
          <span className={cn("chip", isPublic ? "bg-brand-10 text-brand" : "bg-secondary text-secondary")} data-testid="playlist-visibility">
            {isPublic ? <Globe size={11} aria-hidden="true" /> : <EyeOff size={11} aria-hidden="true" />}
            {isPublic ? "Public" : "Private"}
          </span>
          <span className="font-semibold text-primary" data-testid="playlist-count">
            {count} {count === 1 ? "file" : "files"}
          </span>
          {knownBytes > 0 && (
            <span aria-label={partial ? "Total size of files with a known size" : "Total size"} data-testid="playlist-size">
              · {formatBytes(knownBytes)}{partial ? "+" : ""}
            </span>
          )}
          {playlist.hasPassword && (
            <span className="chip bg-secondary text-secondary" data-testid="playlist-password-chip"><Lock size={11} aria-hidden="true" /> Password</span>
          )}
          {(playlist.starsPrice ?? 0) > 0 && (
            <span className="chip bg-secondary text-secondary" data-testid="playlist-stars-chip"><Star size={11} aria-hidden="true" /> {playlist.starsPrice} Stars</span>
          )}
        </div>
        {unpublished > 0 && (
          <p className="text-xs text-secondary -mt-1.5" data-testid="playlist-unpublished-note">
            {unpublished} {unpublished === 1 ? "file isn't" : "files aren't"} published, so visitors can&apos;t open {unpublished === 1 ? "it" : "them"}.
          </p>
        )}

        {/* Primary actions: Add Files · Preview · Share · More */}
        <div className="grid grid-cols-4 gap-2" data-testid="playlist-actions" role="group" aria-label="Playlist actions">
          <button type="button" onClick={onAddFiles} disabled={disabled} data-testid="action-add-files" className={tilePrimary}>
            <ListPlus size={18} aria-hidden="true" /> <span>Add Files</span>
          </button>
          <button type="button" onClick={onPreview} disabled={disabled || previewing} data-testid="action-preview" className={tile}>
            <Eye size={18} aria-hidden="true" /> <span>Preview</span>
          </button>
          <button type="button" onClick={onShare} disabled={disabled} data-testid="playlist-share" className={tile}>
            <Share2 size={18} aria-hidden="true" /> <span>Share</span>
          </button>
          <ActionMenu
            label="More"
            items={menuItems}
            disabled={disabled}
            className="min-w-0"
            triggerClassName={cn(tile, "w-full")}
            triggerContent={
              <>
                <MoreHorizontal size={18} aria-hidden="true" /> <span>More</span>
              </>
            }
            menuClassName="w-60"
          />
        </div>
      </div>
    </section>
  );
}
