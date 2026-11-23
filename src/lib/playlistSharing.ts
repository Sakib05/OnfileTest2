/**
 * Pure (browser + server safe) helpers for playlist sharing. No database or Node-only imports here.
 *
 * A shared playlist is addressed ONLY by an unguessable token (`playlists.share_slug`), never by its numeric id:
 *   public page : /p/<token>
 *   selected file : /p/<token>?f=<file smart-link slug>   (same page, selection only — see src/lib/viewer.ts)
 *   legacy item link: /f/<file smart-link slug>?list=<token>&i=<position> — still produced by `itemHref`; the file page forwards it to the line above
 */

/** Token alphabet/length produced by `generateShareSlug` (base64url). Anything else is rejected before touching the DB. */
export const SHARE_SLUG_RE = /^[A-Za-z0-9_-]{16,32}$/;

export function isValidShareSlug(v: unknown): v is string {
  return typeof v === "string" && SHARE_SLUG_RE.test(v);
}

export function sharePath(slug: string): string {
  return `/p/${encodeURIComponent(slug)}`;
}

/** Absolute public URL of a shared playlist. `origin` has no trailing slash requirement. */
export function buildShareUrl(origin: string, slug: string): string {
  return `${origin.replace(/\/+$/, "")}${sharePath(slug)}`;
}

/** Telegram's share dialog (works in the Telegram browser, the Mini App and any normal browser). */
export function telegramShareUrl(url: string, text?: string): string {
  const q = new URLSearchParams({ url });
  if (text) q.set("text", text);
  return `https://t.me/share/url?${q.toString().replace(/\+/g, "%20")}`;
}

/** Link to ONE item of a playlist inside the existing file page, carrying the playlist context for Previous/Next. */
export function itemHref(fileSlug: string, listSlug: string, position: number): string {
  return `/f/${encodeURIComponent(fileSlug)}?list=${encodeURIComponent(listSlug)}&i=${position}`;
}

/** Reads the `list` query value from the file page; null unless it is a well-formed token. */
export function parseListParam(raw: string | string[] | undefined): string | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return isValidShareSlug(v) ? v : null;
}

export interface PublicPlaylistItem {
  /** 1-based position among the items visible to the public (the creator's saved order). */
  position: number;
  /** Smart-link slug of the file: the existing public file page (/f/<slug>) enforces its password / payment rules. */
  slug: string;
  title: string;
  fileType: string | null;
  mimeType: string | null;
  fileSize: number | null;
  thumbnailUrl: string | null;
  hasPassword: boolean;
  starsPrice: number;
}

export type PlaylistLock = "password" | "stars" | null;

export interface PublicPlaylistPayload {
  playlist: {
    title: string;
    description: string | null;
    thumbnailUrl: string | null;
    itemCount: number;
    hasPassword: boolean;
    locked: PlaylistLock;
  };
  creator: { firstName: string | null; username: string | null; avatarUrl: string | null; customAvatarUrl?: string | null } | null;
  items: PublicPlaylistItem[];
}

/** Neighbours of the item whose file slug is `fileSlug` (by slug — never trusting a client-supplied position). */
export function neighbours(items: PublicPlaylistItem[], fileSlug: string) {
  const index = items.findIndex((i) => i.slug === fileSlug);
  if (index < 0) return null;
  return {
    index,
    position: items[index].position,
    total: items.length,
    previous: index > 0 ? items[index - 1] : null,
    next: index < items.length - 1 ? items[index + 1] : null,
  };
}

const LAST_KEY = (slug: string) => `onfile_pl_last_${slug}`;

/** "Continue" support: remembers the last opened position per playlist on this device only. */
export function rememberPosition(listSlug: string, position: number): void {
  try {
    localStorage.setItem(LAST_KEY(listSlug), String(position));
  } catch {
    /* storage unavailable — Continue simply isn't offered */
  }
}

export function recallPosition(listSlug: string): number | null {
  try {
    const n = Number(localStorage.getItem(LAST_KEY(listSlug)));
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}
