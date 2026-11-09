import { STARS_MAX } from "@/lib/publishing/constants";

export const PLAYLIST_TITLE_MAX = 120;
export const PLAYLIST_DESCRIPTION_MAX = 1000;
export const PLAYLIST_PASSWORD_MAX = 128;

export interface PlaylistInput {
  title: string;
  description: string | null;
  password: string | null;
  starsPrice: number;
}

export type PlaylistFieldErrors = Partial<Record<"title" | "description" | "password" | "starsPrice", string>>;

/**
 * Authoritative server-side validation of a playlist payload (the UI repeats the
 * same rules for fast feedback but is never trusted). `partial` is for PATCH,
 * where absent fields are simply left unchanged.
 */
export function validatePlaylistInput(raw: unknown): { ok: true; value: PlaylistInput } | { ok: false; errors: PlaylistFieldErrors } {
  const errors: PlaylistFieldErrors = {};
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  const title = typeof b.title === "string" ? b.title.trim() : "";
  if (!title) errors.title = "Playlist title is required.";
  else if (title.length > PLAYLIST_TITLE_MAX) errors.title = `Title must be ${PLAYLIST_TITLE_MAX} characters or fewer.`;

  let description: string | null = null;
  if (b.description !== undefined && b.description !== null) {
    if (typeof b.description !== "string") errors.description = "Description must be text.";
    else if (b.description.length > PLAYLIST_DESCRIPTION_MAX) errors.description = `Description must be ${PLAYLIST_DESCRIPTION_MAX} characters or fewer.`;
    else description = b.description.trim() || null;
  }

  let password: string | null = null;
  if (b.password !== undefined && b.password !== null && b.password !== "") {
    if (typeof b.password !== "string") errors.password = "Password must be text.";
    else if (b.password.length > PLAYLIST_PASSWORD_MAX) errors.password = `Password must be ${PLAYLIST_PASSWORD_MAX} characters or fewer.`;
    else password = b.password;
  }

  let starsPrice = 0;
  if (b.starsPrice !== undefined && b.starsPrice !== null && b.starsPrice !== "") {
    const n = typeof b.starsPrice === "number" ? b.starsPrice : typeof b.starsPrice === "string" && /^\d{1,7}$/.test(b.starsPrice.trim()) ? Number(b.starsPrice.trim()) : NaN;
    if (!Number.isInteger(n) || n < 0 || n > STARS_MAX) errors.starsPrice = `Stars price must be a whole number from 0 to ${STARS_MAX}.`;
    else starsPrice = n;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { title, description, password, starsPrice } };
}

/** Parses a path/query id; returns null for anything that is not a positive int32. */
export function parsePositiveId(raw: string | null | undefined): number | null {
  if (typeof raw !== "string" || !/^\d{1,10}$/.test(raw)) return null;
  const n = Number(raw);
  return n > 0 && n <= 2147483647 ? n : null;
}
