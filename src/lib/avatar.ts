/**
 * Helpers for displaying a Telegram profile picture (Telegram `photo_url`).
 *
 * The URL itself always originates from Telegram's signed `initData`
 * (verified server-side in /api/auth/telegram and persisted as
 * `users.avatar_url`). These helpers are display-only and never used for
 * authentication/authorization.
 */

const ALLOWED_AVATAR_HOST_SUFFIXES = ["t.me", "telegram.org", "telegram-cdn.org", "cdn-telegram.org"];

/**
 * Returns the URL unchanged when it is a well-formed https URL on a Telegram
 * host, otherwise `null`. Used so a malformed / unexpected stored value can
 * never be rendered as an `<img src>` (e.g. `javascript:`/`data:` URLs or an
 * arbitrary third-party tracker).
 */
export function sanitizeAvatarUrl(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 2048) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;

  const host = url.hostname.toLowerCase();
  const allowed = ALLOWED_AVATAR_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
  return allowed ? trimmed : null;
}

/** Neutral character used when neither a first name nor a username exists. */
export const DEFAULT_AVATAR_CHAR = "?";

/**
 * First visible character for the fallback avatar. Prefers `firstName`, then
 * `username` (without a leading "@"), then a neutral default. Uses code-point
 * iteration so emoji / non-BMP characters are not split in half.
 */
export function getAvatarInitial(firstName?: string | null, username?: string | null): string {
  const fromName = Array.from((firstName ?? "").trim())[0];
  if (fromName) return fromName.toUpperCase();
  const fromUsername = Array.from((username ?? "").trim().replace(/^@+/, ""))[0];
  if (fromUsername) return fromUsername.toUpperCase();
  return DEFAULT_AVATAR_CHAR;
}
