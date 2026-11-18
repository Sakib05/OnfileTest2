import { describe, expect, it } from "vitest";
import {
  addDays,
  bucketStart,
  buildSeries,
  daysBetween,
  formatBucketTitle,
  formatPeriod,
  granularityFor,
  isValidDateString,
  isValidTimeZone,
  resolveRange,
} from "./playlistAnalyticsRange";

const TODAY = "2026-03-15"; // a Sunday

describe("date helpers", () => {
  it("validates calendar dates strictly", () => {
    expect(isValidDateString("2026-03-15")).toBe(true);
    expect(isValidDateString("2026-02-30")).toBe(false);
    expect(isValidDateString("2026-3-5")).toBe(false);
    expect(isValidDateString("'; DROP TABLE x;--")).toBe(false);
    expect(isValidDateString(undefined)).toBe(false);
  });
  it("adds days across month and year boundaries and counts inclusively", () => {
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2025-12-31", 1)).toBe("2026-01-01");
    expect(daysBetween("2026-03-09", "2026-03-15")).toBe(7);
    expect(daysBetween("2026-03-15", "2026-03-15")).toBe(1);
  });
  it("accepts only real IANA timezones", () => {
    expect(isValidTimeZone("Asia/Dhaka")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone("x'; select 1;--")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });
});

describe("resolveRange", () => {
  it("presets end today (inclusive) and span exactly N days", () => {
    for (const [key, n] of [["7d", 7], ["30d", 30], ["90d", 90]] as const) {
      const r = resolveRange({ range: key }, TODAY, null);
      expect(r).toMatchObject({ ok: true, key, to: TODAY, days: n });
      if (r.ok) expect(r.from).toBe(addDays(TODAY, -(n - 1)));
    }
  });
  it("defaults to 30 days and rejects unknown keys", () => {
    expect(resolveRange({}, TODAY, null)).toMatchObject({ ok: true, key: "30d", days: 30 });
    expect(resolveRange({ range: "forever" }, TODAY, null).ok).toBe(false);
  });
  it("All time starts at the first activity, or today when there is none", () => {
    expect(resolveRange({ range: "all" }, TODAY, "2026-01-01")).toMatchObject({ ok: true, from: "2026-01-01", to: TODAY });
    expect(resolveRange({ range: "all" }, TODAY, null)).toMatchObject({ ok: true, from: TODAY, to: TODAY, days: 1 });
    expect(resolveRange({ range: "all" }, TODAY, "2027-01-01")).toMatchObject({ ok: true, from: TODAY }); // never the future
  });
  it("custom range: valid, clamps the end to today, rejects reversed / future-start / junk", () => {
    expect(resolveRange({ range: "custom", from: "2026-03-01", to: "2026-03-10" }, TODAY, null)).toMatchObject({ ok: true, from: "2026-03-01", to: "2026-03-10", days: 10 });
    expect(resolveRange({ range: "custom", from: "2026-03-01", to: "2030-01-01" }, TODAY, null)).toMatchObject({ ok: true, to: TODAY });
    expect(resolveRange({ range: "custom", from: "2026-03-10", to: "2026-03-01" }, TODAY, null).ok).toBe(false);
    expect(resolveRange({ range: "custom", from: "2026-03-20", to: "2026-03-25" }, TODAY, null).ok).toBe(false);
    expect(resolveRange({ range: "custom", from: "nope", to: "2026-03-01" }, TODAY, null).ok).toBe(false);
    expect(resolveRange({ range: "custom", from: "1999-01-01", to: "2026-03-01" }, TODAY, null).ok).toBe(false);
    expect(resolveRange({ range: "custom" }, TODAY, null).ok).toBe(false);
  });
});

describe("aggregation granularity and buckets", () => {
  it("is daily up to ~3 months, weekly up to ~13 months, monthly beyond", () => {
    expect(granularityFor(7)).toBe("day");
    expect(granularityFor(90)).toBe("day");
    expect(granularityFor(180)).toBe("week");
    expect(granularityFor(800)).toBe("month");
  });
  it("buckets start on Monday / the 1st", () => {
    expect(bucketStart("2026-03-15", "week")).toBe("2026-03-09"); // Sunday → previous Monday
    expect(bucketStart("2026-03-09", "week")).toBe("2026-03-09");
    expect(bucketStart("2026-03-21", "month")).toBe("2026-03-01");
  });
  it("builds a gap-free daily series (missing days are zero) whose sums match the input", () => {
    const daily = new Map([["2026-03-10", { views: 3, downloads: 1 }], ["2026-03-12", { views: 2, downloads: 0 }]]);
    const s = buildSeries("2026-03-09", "2026-03-15", "day", daily);
    expect(s).toHaveLength(7);
    expect(s.map((p) => p.views)).toEqual([0, 3, 0, 2, 0, 0, 0]);
    expect(s.reduce((a, p) => a + p.downloads, 0)).toBe(1);
  });
  it("folds days into weekly buckets without losing or double counting events", () => {
    const daily = new Map([["2026-03-02", { views: 1, downloads: 1 }], ["2026-03-08", { views: 1, downloads: 0 }], ["2026-03-09", { views: 5, downloads: 2 }]]);
    const s = buildSeries("2026-03-02", "2026-03-15", "week", daily);
    expect(s).toEqual([
      { date: "2026-03-02", views: 2, downloads: 1 },
      { date: "2026-03-09", views: 5, downloads: 2 },
    ]);
  });
});

describe("labels", () => {
  it("formats the selected period and tooltip titles", () => {
    expect(formatPeriod("2026-03-09", "2026-03-15")).toBe("Mar 9 – Mar 15, 2026");
    expect(formatPeriod("2026-03-15", "2026-03-15")).toBe("Mar 15, 2026");
    expect(formatBucketTitle("2026-03-09", "week")).toBe("Week of Mar 9, 2026");
    expect(formatBucketTitle("2026-03-01", "month")).toBe("March 2026");
    expect(formatBucketTitle("2026-03-09", "day")).toContain("Mar 9, 2026");
  });
});
