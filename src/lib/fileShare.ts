/**
 * Share-link rules for one Library file (pure, UI-free, unit-tested).
 *
 * The ONLY shareable address of a file is its public smart link `/f/<slug>`; that page is served by the existing
 * access-control system (`GET /api/link/:slug` answers 404 unless the file is published, and password-protected /
 * Stars-priced files still ask for the password / payment on that page). So:
 *   - a published file with a slug  → link available (a password is NOT part of the link);
 *   - an unpublished (private) file → NO link: the page would be a dead end, and we never fabricate a bypass;
 *   - nothing here ever returns a Telegram message link, file id or any internal identifier.
 */

export interface ShareableFile {
  smartLinkSlug?: string | null;
  isPublished?: boolean | null;
}

export type ShareAvailability =
  | { ok: true; path: string }
  | { ok: false; reason: "private" | "no_link"; message: string };

export function fileShareAvailability(file: ShareableFile): ShareAvailability {
  if (!file.isPublished) {
    return { ok: false, reason: "private", message: "This file is private (not published), so it has no public link. Publish it to share it." };
  }
  const slug = typeof file.smartLinkSlug === "string" ? file.smartLinkSlug.trim() : "";
  if (!slug) {
    return { ok: false, reason: "no_link", message: "This file doesn't have a share link yet." };
  }
  return { ok: true, path: `/f/${encodeURIComponent(slug)}` };
}

/** Absolute share URL for `origin` (e.g. `window.location.origin`), or null when the file can't be shared. */
export function fileShareUrl(origin: string, file: ShareableFile): string | null {
  const a = fileShareAvailability(file);
  return a.ok ? `${origin.replace(/\/+$/, "")}${a.path}` : null;
}
