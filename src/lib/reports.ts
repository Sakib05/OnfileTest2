/**
 * Pure (browser + server safe) definitions for public content reports.
 * No database or Node-only imports: the dialog and the API route share the same reason list and validation.
 */

export const REPORT_REASONS = [
  { value: "copyright", label: "Copyright or unauthorized content" },
  { value: "inappropriate", label: "Inappropriate content" },
  { value: "spam", label: "Spam or misleading content" },
  { value: "broken_link", label: "Broken or unavailable content" },
  { value: "other", label: "Other" },
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number]["value"];

export type ReportTarget = "file" | "playlist";

export const REPORT_DETAILS_MAX = 1000;

const REASON_VALUES: readonly string[] = REPORT_REASONS.map((r) => r.value);
const SLUG_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function isReportReason(v: unknown): v is ReportReason {
  return typeof v === "string" && REASON_VALUES.includes(v);
}

/** Trims, drops control characters (keeps newlines/tabs) and caps the length. Returns null when empty. */
export function cleanReportDetails(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const cleaned = v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, REPORT_DETAILS_MAX);
  return cleaned || null;
}

export interface ParsedReport {
  target: ReportTarget;
  /** File smart-link slug (target "file"). */
  fileSlug: string | null;
  /** Playlist share token (target "playlist"). */
  playlistSlug: string | null;
  reason: ReportReason;
  details: string | null;
  /** True when the hidden honeypot field was filled in (a bot). Such requests are silently ignored. */
  honeypot: boolean;
}

/** Structural validation only — whether the target exists/is public is decided by the route against the database. */
export function parseReportBody(body: unknown): ParsedReport | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const target = b.target;
  if (target !== "file" && target !== "playlist") return null;
  if (!isReportReason(b.reason)) return null;

  const slug = typeof b.slug === "string" ? b.slug : "";
  if (!SLUG_RE.test(slug)) return null;

  return {
    target,
    fileSlug: target === "file" ? slug : null,
    playlistSlug: target === "playlist" ? slug : null,
    reason: b.reason,
    details: cleanReportDetails(b.details),
    honeypot: typeof b.website === "string" && b.website.length > 0,
  };
}
