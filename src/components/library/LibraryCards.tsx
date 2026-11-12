"use client";
import React, { memo } from "react";
import { MoreHorizontal, Lock, Star, Eye, Download } from "lucide-react";
import { cn, formatNumber } from "@/lib/utils";
import FileThumb from "@/components/ui/FileThumb";
import PlaylistThumb from "@/components/ui/PlaylistThumb";
import FileTypeBadge from "./FileTypeBadge";
import RelativeTime from "./RelativeTime";
import { parseTimestamp } from "@/lib/relativeTime";
import type { CardLayout, FileItem, PlaylistItem } from "./types";

/**
 * Thumbnail frame per layout. The frame fixes the aspect ratio, so the cover
 * image (object-cover: scaled uniformly, never stretched) and the FileTypeArt
 * fallback both fill it without layout shift.
 */
const THUMB_FRAME: Record<CardLayout, string> = {
  list: "w-28 aspect-[4/3] flex-shrink-0",
  grid: "w-full aspect-video",
  row: "w-full aspect-video",
};

const SHELL: Record<CardLayout, string> = {
  list: "flex items-center gap-3 p-3 bg-card border border-app rounded-2xl shadow-app-sm",
  grid: "flex flex-col gap-2.5 p-2.5 bg-card border border-app rounded-2xl shadow-app-sm min-w-0",
  row: "flex flex-col gap-2 w-[168px] flex-shrink-0 snap-start",
};

interface CardShellProps {
  layout: CardLayout;
  thumb: React.ReactNode;
  /** Overlaid inside the thumbnail frame (top-right), so it stays attached to the artwork. */
  thumbBadge?: React.ReactNode;
  title: string;
  titleSuffix?: React.ReactNode;
  /** Quiet secondary line directly under the title (e.g. "2 hours ago"). */
  subtitle?: React.ReactNode;
  badges?: React.ReactNode;
  stats?: React.ReactNode;
  openLabel: string;
  menuLabel: string;
  onOpen: () => void;
  onMenu: (anchor: DOMRect) => void;
  testId: string;
}

/** One card, three layouts. Used for both files and playlists so they stay visually identical. */
function CardShell({ layout, thumb, thumbBadge, title, titleSuffix, subtitle, badges, stats, openLabel, menuLabel, onOpen, onMenu, testId }: CardShellProps) {
  const menuButton = (
    <button
      type="button"
      aria-label={menuLabel}
      aria-haspopup="menu"
      onClick={(e) => onMenu(e.currentTarget.getBoundingClientRect())}
      className={cn(
        "flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-secondary hover:bg-secondary active:bg-secondary transition-colors",
        layout !== "list" && "-mr-2 -mt-1.5"
      )}
    >
      <MoreHorizontal size={16} />
    </button>
  );

  const thumbBox = (
    <span className={cn("block relative overflow-hidden rounded-xl bg-secondary", THUMB_FRAME[layout])}>
      {thumb}
      {thumbBadge}
    </span>
  );

  const text = (
    <span className="block min-w-0 flex-1 text-left">
      <span className="flex items-center gap-1.5 min-w-0">
        <span className="font-semibold text-primary text-sm leading-snug line-clamp-2 break-words">{title}</span>
        {titleSuffix}
      </span>
      {subtitle && <span className="block mt-0.5 text-xs text-muted truncate">{subtitle}</span>}
      {badges && <span className="flex items-center gap-1.5 mt-1.5 flex-wrap">{badges}</span>}
      {stats && <span className="flex items-center gap-x-3 gap-y-1 mt-1.5 flex-wrap text-xs text-secondary">{stats}</span>}
    </span>
  );

  if (layout === "list") {
    return (
      <div className={SHELL.list} data-testid={testId} data-layout="list">
        <button type="button" onClick={onOpen} aria-label={openLabel} className="flex flex-1 min-w-0 items-center gap-3 text-left">
          {thumbBox}
          {text}
        </button>
        {menuButton}
      </div>
    );
  }

  // grid / row: artwork on top, text underneath. Whole thumbnail opens the item.
  return (
    <div className={SHELL[layout]} data-testid={testId} data-layout={layout}>
      <button type="button" onClick={onOpen} aria-label={openLabel} className="block w-full text-left">
        {thumbBox}
      </button>
      <div className="flex items-start gap-1 min-w-0">
        <button type="button" onClick={onOpen} tabIndex={-1} aria-hidden="true" className="flex-1 min-w-0 text-left">
          {text}
        </button>
        {menuButton}
      </div>
    </div>
  );
}

const Stat = ({ icon: Icon, value }: { icon: typeof Eye; value: number }) => (
  <span className="inline-flex items-center gap-1">
    <Icon size={11} aria-hidden="true" />
    {formatNumber(value)}
  </span>
);

interface FileCardProps {
  file: FileItem;
  layout: CardLayout;
  onOpen: (file: FileItem) => void;
  onMenu: (file: FileItem, anchor: DOMRect) => void;
}

/**
 * A file card. Shows title, upload age, views, downloads, earnings and lock / Stars status — never the
 * file size. The file-type tag is pinned to the thumbnail's top-right corner (not below it).
 */
export const FileCard = memo(function FileCard({ file, layout, onOpen, onMenu }: FileCardProps) {
  const compact = layout === "row";
  return (
    <CardShell
      layout={layout}
      testId="file-card"
      title={file.title}
      titleSuffix={file.password ? <Lock size={11} className="text-brand flex-shrink-0" aria-label="Password protected" /> : null}
      openLabel={`Open details for ${file.title}`}
      menuLabel={`More actions for ${file.title}`}
      onOpen={() => onOpen(file)}
      onMenu={(a) => onMenu(file, a)}
      thumb={<FileThumb url={file.thumbnailUrl} fileType={file.fileType} title={file.title} mimeType={file.mimeType} />}
      thumbBadge={<FileTypeBadge fileType={file.fileType} />}
      subtitle={parseTimestamp(file.createdAt) !== null ? <RelativeTime value={file.createdAt} /> : undefined}
      badges={
        (file.starsPrice ?? 0) > 0 ? (
          <span className="chip bg-yellow-50 text-yellow-600 dark:bg-yellow-900/20 dark:text-yellow-400" style={{ padding: "2px 8px", fontSize: 11 }}>
            ⭐ {file.starsPrice}
          </span>
        ) : undefined
      }
      stats={
        <>
          <Stat icon={Eye} value={file.views ?? 0} />
          <Stat icon={Download} value={file.downloads ?? 0} />
          {!compact && <span className="text-brand font-medium">+${Number(file.earnings ?? 0).toFixed(2)}</span>}
        </>
      }
    />
  );
});

interface PlaylistCardProps {
  playlist: PlaylistItem;
  layout: CardLayout;
  onOpen: (playlist: PlaylistItem) => void;
  onMenu: (playlist: PlaylistItem, anchor: DOMRect) => void;
}

export const PlaylistCard = memo(function PlaylistCard({ playlist, layout, onOpen, onMenu }: PlaylistCardProps) {
  return (
    <CardShell
      layout={layout}
      testId="playlist-card"
      title={playlist.title}
      titleSuffix={
        <>
          {playlist.hasPassword && <Lock size={11} className="text-brand flex-shrink-0" aria-label="Password protected" />}
          {(playlist.starsPrice ?? 0) > 0 && <Star size={11} className="text-yellow-500 flex-shrink-0" aria-label="Paid" />}
        </>
      }
      openLabel={`Open playlist ${playlist.title}`}
      menuLabel={`More actions for playlist ${playlist.title}`}
      onOpen={() => onOpen(playlist)}
      onMenu={(a) => onMenu(playlist, a)}
      thumb={<PlaylistThumb url={playlist.thumbnailUrl} />}
      badges={
        <span className="chip bg-brand-10 text-brand" style={{ padding: "2px 8px", fontSize: 11 }}>
          {playlist.totalFiles ?? 0} {(playlist.totalFiles ?? 0) === 1 ? "file" : "files"}
        </span>
      }
      stats={<Stat icon={Download} value={playlist.totalDownloads ?? 0} />}
    />
  );
});

/** Loading placeholders matching the card geometry (no layout jump when data arrives). */
export function LibrarySkeleton({ layout }: { layout: "list" | "grid" }) {
  return (
    <div className={cn(layout === "grid" ? "grid grid-cols-2 gap-3" : "flex flex-col gap-3")} aria-busy="true" aria-label="Loading library">
      {[1, 2, 3, 4].slice(0, layout === "grid" ? 4 : 3).map((i) => (
        <div
          key={i}
          className={cn(
            "bg-card rounded-2xl border border-app animate-pulse-brand",
            layout === "grid" ? "h-[190px]" : "h-[108px]"
          )}
        />
      ))}
    </div>
  );
}
