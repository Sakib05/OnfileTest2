import { PLAYLIST_TITLE_MAX } from "@/lib/playlists";

/** Mirrors the server's per-request cap on playlist membership writes (MAX_FILES_PER_REQUEST in playlistMembers.ts, which is server-only). */
export const ADD_FILES_CHUNK = 200;

/** Minimal shape needed to summarise a playlist's files (structurally compatible with the API rows). */
export interface SummarisableFile {
  fileSize: number | null;
  isPublished: boolean | null;
  smartLinkSlug?: string | null;
}

export interface FileSummary {
  count: number;
  /** Sum of the sizes that are actually known. */
  knownBytes: number;
  /** True when at least one file has no recorded size (the total is then a lower bound). */
  partial: boolean;
  /** Files that visitors cannot open (not published or no smart link). */
  unpublished: number;
}

export function summariseFiles(list: SummarisableFile[]): FileSummary {
  let knownBytes = 0;
  let unknown = 0;
  let unpublished = 0;
  for (const f of list) {
    if (f.fileSize && f.fileSize > 0) knownBytes += f.fileSize;
    else unknown += 1;
    if (!f.isPublished || !f.smartLinkSlug) unpublished += 1;
  }
  return { count: list.length, knownBytes, partial: unknown > 0 && knownBytes > 0, unpublished };
}

/** "Copy of <title>", never longer than the server's title limit. */
export function duplicateTitle(title: string): string {
  const prefix = "Copy of ";
  const room = PLAYLIST_TITLE_MAX - prefix.length;
  return prefix + (title.length > room ? title.slice(0, room - 1).trimEnd() + "…" : title);
}

/** Splits ids into request-sized chunks, preserving order (the add endpoint accepts a bounded number of ids). */
export function chunkIds(ids: number[], size = ADD_FILES_CHUNK): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

/** Moves `fileId` to the front, keeping every other file's relative order. Returns the same array when nothing changes. */
export function moveToFront<T extends { id: number }>(list: T[], fileId: number): T[] {
  const i = list.findIndex((f) => f.id === fileId);
  if (i <= 0) return list;
  return [list[i], ...list.slice(0, i), ...list.slice(i + 1)];
}

export type PreviewBlock = "private" | "paid" | null;

/**
 * Whether the playlist has a public page a visitor could open. Private playlists have none (the public
 * route answers 404 for them) and Stars-priced playlists cannot be shared. Preview never changes either
 * setting — it only explains why it is unavailable.
 */
export function previewBlock(p: { isPublished?: boolean; starsPrice?: number }): PreviewBlock {
  if (!p.isPublished) return "private";
  if ((p.starsPrice ?? 0) > 0) return "paid";
  return null;
}
