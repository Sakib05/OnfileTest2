/**
 * Shared (client + server) limits and option lists for the Publish flow.
 * Single source of truth so the UI and the server validators never drift.
 */

export const TITLE_MAX = 100;
export const DESCRIPTION_MAX = 1000;
export const PASSWORD_MAX = 64;

/** Telegram Stars price bounds (whole Stars). */
export const STARS_MIN = 1;
export const STARS_MAX = 10_000;

// Previously defined inline in CreateTab; moved here unchanged.
export const CATEGORIES = [
  "Education",
  "Entertainment",
  "Music",
  "Design",
  "Books",
  "Software",
  "Games",
  "Stock",
  "Other",
] as const;

// Mirrors the `file_type` pg enum in src/db/schema.ts.
export const FILE_TYPES = ["video", "audio", "document", "image", "archive", "other"] as const;
export type FileTypeValue = (typeof FILE_TYPES)[number];

export type Monetization = "free" | "paid";
export type PublishMode = "publish" | "draft";

export const THUMBNAIL_ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const THUMBNAIL_MAX_BYTES = 5 * 1024 * 1024;
