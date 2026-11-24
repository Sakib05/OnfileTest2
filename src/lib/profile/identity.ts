/**
 * Single source of truth for a user's DISPLAYED identity (name + picture).
 *
 * Pure functions only (no DB / env access besides the injected `urlFor`) so the exact same rules are used by
 * the session endpoint, the public creator payloads and the Edit Profile form.
 *
 * Avatar priority (everywhere):
 *   1. custom uploaded picture   (`users.profile_image_key` → storage URL)
 *   2. Telegram profile picture  (`users.avatar_url`, synced from verified initData)
 *   3. initial-letter avatar     (rendered by <TelegramAvatar/> when neither image exists / loads)
 * Display name: custom name (`users.display_name_custom`) → Telegram first name → "Creator".
 */

export const DISPLAY_NAME_MAX = 64;
export const DISPLAY_NAME_FALLBACK = "Creator";

export type DisplayNameResult = { ok: true; value: string | null } | { ok: false; error: string };

// C0/C1 control chars, bidi overrides/isolates and zero-width chars (spoofing / invisible names).
const FORBIDDEN_CHARS = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/;
// Angle brackets are rejected so a name can never be turned into markup anywhere it is echoed.
const FORBIDDEN_MARKUP = /[<>]/;

/**
 * Validates + normalises a custom display name.
 * - Surrounding whitespace is trimmed and inner whitespace runs are collapsed to one space.
 * - An empty value is valid and means "clear the custom name" (`value: null` → Telegram name is used again).
 * - Max 64 characters (counted as Unicode code points, so emoji are not double-counted).
 */
export function validateDisplayName(raw: unknown): DisplayNameResult {
  if (typeof raw !== "string") return { ok: false, error: "Display name must be text." };
  if (raw.length > DISPLAY_NAME_MAX * 4) return { ok: false, error: `Display name must be ${DISPLAY_NAME_MAX} characters or fewer.` };
  const normalized = raw.replace(/\s+/g, " ").trim();
  if (!normalized) return { ok: true, value: null };
  if (FORBIDDEN_CHARS.test(normalized)) return { ok: false, error: "Display name contains characters that are not allowed." };
  if (FORBIDDEN_MARKUP.test(normalized)) return { ok: false, error: "Display name can't contain < or >." };
  if (Array.from(normalized).length > DISPLAY_NAME_MAX) {
    return { ok: false, error: `Display name must be ${DISPLAY_NAME_MAX} characters or fewer.` };
  }
  return { ok: true, value: normalized };
}

/** Custom display name → Telegram first name → null (callers add their own last-resort label). */
export function resolveDisplayName(customName: string | null | undefined, telegramFirstName: string | null | undefined): string | null {
  const custom = customName?.trim();
  if (custom) return custom;
  const tg = telegramFirstName?.trim();
  return tg || null;
}

export interface IdentityRow {
  firstName: string | null;
  displayNameCustom: string | null;
  username: string | null;
  avatarUrl: string | null;
  profileImageKey: string | null;
}

export interface EffectiveIdentity {
  /** Custom name, else Telegram first name, else null. */
  displayName: string | null;
  /** Public URL of the custom picture, or null when there is none (or storage isn't configured). */
  customAvatarUrl: string | null;
}

/**
 * `urlFor` maps a stored object key to its public URL (production: `buildThumbnailUrl`). When it returns null
 * (storage not configured) the custom picture is treated as absent so the Telegram photo / initials still show.
 */
export function resolveIdentity(row: IdentityRow, urlFor: (key: string) => string | null): EffectiveIdentity {
  return {
    displayName: resolveDisplayName(row.displayNameCustom, row.firstName),
    customAvatarUrl: row.profileImageKey ? urlFor(row.profileImageKey) : null,
  };
}
