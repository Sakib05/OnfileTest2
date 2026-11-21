/**
 * Pure (browser + server safe) creator-profile rules, shared by the Edit Profile screen and the API so the client
 * and server can never disagree. The server always re-validates; client checks are only for fast feedback.
 */

export const DISPLAY_NAME_MAX = 64;

/** Profile picture limits (same 2 MiB cap and formats as thumbnails). */
export const PROFILE_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
export const PROFILE_IMAGE_MAX_LABEL = "2 MB";
export const PROFILE_IMAGE_ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"] as const;
/** Value for <input accept>. (JPG/JPEG share image/jpeg.) */
export const PROFILE_IMAGE_ACCEPT = ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp";

// Control characters, zero-width characters and bidi overrides/isolates are never allowed in a display name.
const FORBIDDEN_NAME_CHARS = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/;

export type DisplayNameCheck = { ok: true; value: string } | { ok: false; error: string };

/** Trims, collapses inner whitespace and validates a Display Name. */
export function validateDisplayName(input: unknown): DisplayNameCheck {
  if (typeof input !== "string") return { ok: false, error: "Display name must be text." };
  if (FORBIDDEN_NAME_CHARS.test(input.replace(/[\t\n\r ]+/g, " "))) {
    return { ok: false, error: "Display name contains characters that aren't allowed." };
  }
  const value = input.normalize("NFC").replace(/\s+/g, " ").trim();
  if (!value) return { ok: false, error: "Display name can't be empty." };
  if (Array.from(value).length > DISPLAY_NAME_MAX) {
    return { ok: false, error: `Display name must be ${DISPLAY_NAME_MAX} characters or fewer.` };
  }
  return { ok: true, value };
}

export type ProfileImageCheck = { ok: true } | { ok: false; error: string };

/** Fast client-side pre-check (type + size). The server independently checks magic bytes and decodes the image. */
export function checkProfileImageFile(file: { type: string; size: number }): ProfileImageCheck {
  if (!(PROFILE_IMAGE_ALLOWED_MIME as readonly string[]).includes(file.type)) {
    return { ok: false, error: "Only JPG, PNG and WebP images are allowed." };
  }
  if (file.size <= 0) return { ok: false, error: "The selected file is empty." };
  if (file.size > PROFILE_IMAGE_MAX_BYTES) {
    return { ok: false, error: `Image must be ${PROFILE_IMAGE_MAX_LABEL} or smaller.` };
  }
  return { ok: true };
}
