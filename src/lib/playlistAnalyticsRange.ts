/**
 * Pure (DB-free, React-free) date-range + bucketing logic for the Creator Playlist Analytics page.
 *
 * Everything works on calendar dates (`YYYY-MM-DD`) in the VIEWER'S timezone: the server asks Postgres for
 * "today in that timezone" and groups events by their local date, so day boundaries are consistent between the
 * summary cards, the chart and the "selected period" label. No `Date` objects in local time are used here — only
 * UTC arithmetic on date strings, so results never depend on the server's own timezone.
 */

export const RANGE_KEYS = ["7d", "30d", "90d", "all", "custom"] as const;
export type RangeKey = (typeof RANGE_KEYS)[number];

export type Granularity = "day" | "week" | "month";

/** Earliest date the custom picker accepts (Onfile did not exist before this). */
export const MIN_CUSTOM_DATE = "2020-01-01";

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

export function isValidDateString(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(y, mo - 1, d);
  const dt = new Date(t);
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

function toMs(s: string): number {
  const m = DATE_RE.exec(s)!;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function fromMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(s: string, n: number): string {
  return fromMs(toMs(s) + n * DAY_MS);
}

/** Inclusive number of calendar days between two dates. */
export function daysBetween(from: string, to: string): number {
  return Math.round((toMs(to) - toMs(from)) / DAY_MS) + 1;
}

/** Valid IANA timezone? (Used to reject junk before it reaches SQL.) */
export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz.length === 0 || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export type RangeRequest = { range?: string | null; from?: string | null; to?: string | null };

export type ResolvedRange =
  | { ok: true; key: RangeKey; from: string; to: string; days: number; granularity: Granularity }
  | { ok: false; error: string };

export function granularityFor(days: number): Granularity {
  if (days <= 92) return "day";
  if (days <= 400) return "week";
  return "month";
}

/**
 * Resolves the requested period to concrete calendar dates.
 * @param today        today's date in the viewer's timezone (from the database clock, not the client).
 * @param firstEvent   earliest local date that has an event / the playlist's creation date — start of "All time".
 */
export function resolveRange(req: RangeRequest, today: string, firstEvent: string | null): ResolvedRange {
  const key = (req.range ?? "30d") as RangeKey;
  if (!RANGE_KEYS.includes(key)) return { ok: false, error: "Unknown date range" };

  let from: string;
  let to = today;

  if (key === "7d" || key === "30d" || key === "90d") {
    const n = key === "7d" ? 7 : key === "30d" ? 30 : 90;
    from = addDays(today, -(n - 1));
  } else if (key === "all") {
    const start = firstEvent && isValidDateString(firstEvent) && firstEvent <= today ? firstEvent : today;
    from = start < MIN_CUSTOM_DATE ? MIN_CUSTOM_DATE : start;
  } else {
    if (!isValidDateString(req.from) || !isValidDateString(req.to)) return { ok: false, error: "Choose a valid start and end date" };
    if (req.from > req.to) return { ok: false, error: "The start date must be on or before the end date" };
    if (req.from > today) return { ok: false, error: "The start date can't be in the future" };
    if (req.from < MIN_CUSTOM_DATE) return { ok: false, error: "The start date is too far in the past" };
    from = req.from;
    to = req.to > today ? today : req.to; // never report on days that haven't happened yet
  }

  const days = daysBetween(from, to);
  return { ok: true, key, from, to, days, granularity: granularityFor(days) };
}

/** Start date of the bucket a day belongs to (weeks start on Monday, months on the 1st). */
export function bucketStart(day: string, g: Granularity): string {
  if (g === "day") return day;
  if (g === "month") return `${day.slice(0, 7)}-01`;
  const dow = new Date(toMs(day)).getUTCDay(); // 0 = Sunday
  return addDays(day, -((dow + 6) % 7));
}

export interface DailyCounts {
  views: number;
  downloads: number;
}

export interface SeriesPoint {
  /** Bucket start date (YYYY-MM-DD). For daily data this is the day itself. */
  date: string;
  views: number;
  downloads: number;
}

/**
 * Builds the full, gap-free series for [from, to]: every bucket exists (missing days are zero, not skipped), and the
 * daily rows from the database are folded into their bucket.
 */
export function buildSeries(from: string, to: string, g: Granularity, daily: ReadonlyMap<string, DailyCounts>): SeriesPoint[] {
  const points = new Map<string, SeriesPoint>();
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const b = bucketStart(d, g);
    if (!points.has(b)) points.set(b, { date: b, views: 0, downloads: 0 });
    const c = daily.get(d);
    if (c) {
      const p = points.get(b)!;
      p.views += c.views;
      p.downloads += c.downloads;
    }
  }
  return [...points.values()];
}

export function formatDateLabel(date: string, g: Granularity): string {
  const dt = new Date(toMs(date));
  if (g === "month") return dt.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** Human readable period, e.g. "Mar 3 – Mar 9, 2026". */
export function formatPeriod(from: string, to: string): string {
  const f = new Date(toMs(from));
  const t = new Date(toMs(to));
  const opts = { month: "short", day: "numeric", timeZone: "UTC" } as const;
  const sameYear = f.getUTCFullYear() === t.getUTCFullYear();
  const left = f.toLocaleDateString("en-US", sameYear ? opts : { ...opts, year: "numeric" });
  const right = t.toLocaleDateString("en-US", { ...opts, year: "numeric" });
  return from === to ? right : `${left} – ${right}`;
}

/** Tooltip title for a chart bucket, e.g. "Mon, Mar 3, 2026" / "Week of Mar 3, 2026" / "March 2026". */
export function formatBucketTitle(date: string, g: Granularity): string {
  const dt = new Date(toMs(date));
  if (g === "month") return dt.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const full = dt.toLocaleDateString("en-US", { weekday: g === "day" ? "short" : undefined, month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  return g === "week" ? `Week of ${full}` : full;
}
