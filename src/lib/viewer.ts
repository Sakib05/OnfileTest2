/**
 * Pure helpers for the unified playlist / file viewer (no React, no DB).
 */
import { formatBytes } from "@/lib/utils";
import { fileKindLabel } from "@/lib/fileKinds";
import type { PublicPlaylistItem } from "@/lib/playlistSharing";

/** Query parameter holding the selected file's public smart-link slug on the playlist route: /p/<token>?f=<slug>. */
export const FILE_PARAM = "f";

const FILE_SLUG_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Reads `?f=` from a search string; null unless it is a well-formed slug. */
export function parseFileParam(search: string): string | null {
  try {
    const v = new URLSearchParams(search).get(FILE_PARAM);
    return v && FILE_SLUG_RE.test(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * Which item is selected: the URL's file if it is really one of the items the server returned,
 * otherwise the first item. An unknown, unpublished or hidden slug can therefore never select anything.
 */
export function resolveSelected(items: PublicPlaylistItem[], wanted: string | null): PublicPlaylistItem | null {
  if (items.length === 0) return null;
  return (wanted ? items.find((i) => i.slug === wanted) : undefined) ?? items[0];
}

/** Same-document URL for a selection (keeps the existing playlist route; no other params are touched). */
export function selectionUrl(playlistSlug: string, fileSlug: string): string {
  return `/p/${encodeURIComponent(playlistSlug)}?${FILE_PARAM}=${encodeURIComponent(fileSlug)}`;
}

const NO_PLURAL = new Set(["audio", "video"]);
const KIND_WORD: Record<string, string> = { video: "video", audio: "audio", document: "document", image: "image", archive: "archive" };

/** "Playlist • 13 audio" — one kind → "13 audio" / "3 documents"; mixed kinds → "13 files". */
export function playlistSummary(items: Pick<PublicPlaylistItem, "fileType">[]): string {
  const n = items.length;
  const kinds = new Set(items.map((i) => (i.fileType && KIND_WORD[i.fileType] ? i.fileType : "other")));
  let noun = n === 1 ? "file" : "files";
  if (kinds.size === 1) {
    const only = [...kinds][0];
    if (only !== "other") {
      const w = KIND_WORD[only];
      noun = NO_PLURAL.has(w) || n === 1 ? w : `${w}s`;
    }
  }
  return `Playlist • ${n} ${noun}`;
}

/** Public single-file link (the existing /f/<slug> page). */
export function fileShareUrl(origin: string, slug: string): string {
  return `${origin.replace(/\/+$/, "")}/f/${encodeURIComponent(slug)}`;
}

/** "PDF · 4.2 MB" — type and size where known (no "Unknown size" filler). */
export function typeAndSize(file: { title?: string | null; fileType?: string | null; mimeType?: string | null; fileSize?: number | null }): string {
  const parts = [fileKindLabel({ title: file.title ?? null, fileType: file.fileType ?? null, mimeType: file.mimeType ?? null })];
  if (file.fileSize && file.fileSize > 0) parts.push(formatBytes(file.fileSize));
  return parts.filter(Boolean).join(" · ");
}

const LONG_DESCRIPTION = 110;

/** A description is collapsible when it would not fit the short (2-line) preview. */
export function isLongDescription(text: string): boolean {
  return text.length > LONG_DESCRIPTION || text.split(/\r?\n/).length > 2;
}
