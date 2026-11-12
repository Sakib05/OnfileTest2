/**
 * "How long ago was this uploaded?" formatting for Library file cards.
 *
 * Pure and UI-free. The input is the file's existing `createdAt` (the `files.created_at`
 * column — the moment the record was created, i.e. the upload/publish time). It is already
 * part of the single `/api/files` snapshot, so no extra query is made per card.
 *
 * Timezone: the result depends only on the *elapsed* time between two absolute instants
 * (`createdAt` and "now"), never on a calendar/locale, so it is identical in every timezone.
 * `files.created_at` is a `timestamp` (no zone) written as UTC; the API serialises it as an
 * ISO string with a `Z`. A string with no zone designator is therefore interpreted as UTC
 * (never as the viewer's local time), which keeps the result correct for viewers anywhere.
 *
 * Invalid / missing values return `null` so the UI can simply omit the label — a timestamp is
 * never invented.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Parses a Date / ISO string / epoch ms into epoch ms, or null when missing or invalid. */
export function parseTimestamp(value: string | number | Date | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isNaN(t) ? null : t;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;

  let s = value.trim();
  if (!s) return null;
  // "2025-01-02 03:04:05" (Postgres text form) → ISO. No zone designator → UTC.
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(s) && !/(Z|[+-]\d{2}(:?\d{2})?)$/i.test(s)) {
    s = `${s.replace(" ", "T")}Z`;
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"} ago`;

/**
 * Examples: "Just now", "5 minutes ago", "2 hours ago", "Yesterday", "3 days ago",
 * "2 weeks ago", "1 month ago", "1 year ago". Returns null for a missing/invalid timestamp.
 * A timestamp slightly in the future (clock skew) reads as "Just now".
 */
export function formatRelativeTime(value: string | number | Date | null | undefined, now: number = Date.now()): string | null {
  const t = parseTimestamp(value);
  if (t === null) return null;

  const elapsed = now - t;
  if (elapsed < MINUTE) return "Just now"; // includes small negative (skew) values

  if (elapsed < HOUR) return plural(Math.floor(elapsed / MINUTE), "minute");
  if (elapsed < DAY) return plural(Math.floor(elapsed / HOUR), "hour");

  const days = Math.floor(elapsed / DAY);
  if (days === 1) return "Yesterday";
  if (days < 7) return plural(days, "day");
  if (days < 30) return plural(Math.floor(days / 7), "week");
  if (days < 365) return plural(Math.min(11, Math.floor(days / 30)), "month");
  return plural(Math.floor(days / 365), "year");
}

/** Full, locale-aware date for the element's tooltip (`title`). Null when invalid. */
export function formatAbsoluteDate(value: string | number | Date | null | undefined): string | null {
  const t = parseTimestamp(value);
  if (t === null) return null;
  try {
    return new Date(t).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return new Date(t).toISOString();
  }
}
