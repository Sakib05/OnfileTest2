import { describe, expect, it } from "vitest";
import { formatAbsoluteDate, formatRelativeTime, parseTimestamp } from "./relativeTime";

const NOW = Date.parse("2025-06-15T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("formatRelativeTime", () => {
  it("says 'Just now' for under a minute and for small future skew", () => {
    expect(formatRelativeTime(ago(0), NOW)).toBe("Just now");
    expect(formatRelativeTime(ago(59_000), NOW)).toBe("Just now");
    expect(formatRelativeTime(new Date(NOW + 30_000).toISOString(), NOW)).toBe("Just now");
  });

  it("formats minutes and hours with correct singular/plural", () => {
    expect(formatRelativeTime(ago(MIN), NOW)).toBe("1 minute ago");
    expect(formatRelativeTime(ago(5 * MIN), NOW)).toBe("5 minutes ago");
    expect(formatRelativeTime(ago(59 * MIN), NOW)).toBe("59 minutes ago");
    expect(formatRelativeTime(ago(HOUR), NOW)).toBe("1 hour ago");
    expect(formatRelativeTime(ago(2 * HOUR), NOW)).toBe("2 hours ago");
    expect(formatRelativeTime(ago(23 * HOUR + 59 * MIN), NOW)).toBe("23 hours ago");
  });

  it("formats days, 'Yesterday', weeks, months and years", () => {
    expect(formatRelativeTime(ago(DAY), NOW)).toBe("Yesterday");
    expect(formatRelativeTime(ago(47 * HOUR), NOW)).toBe("Yesterday");
    expect(formatRelativeTime(ago(3 * DAY), NOW)).toBe("3 days ago");
    expect(formatRelativeTime(ago(6 * DAY), NOW)).toBe("6 days ago");
    expect(formatRelativeTime(ago(7 * DAY), NOW)).toBe("1 week ago");
    expect(formatRelativeTime(ago(14 * DAY), NOW)).toBe("2 weeks ago");
    expect(formatRelativeTime(ago(29 * DAY), NOW)).toBe("4 weeks ago");
    expect(formatRelativeTime(ago(30 * DAY), NOW)).toBe("1 month ago");
    expect(formatRelativeTime(ago(95 * DAY), NOW)).toBe("3 months ago");
    expect(formatRelativeTime(ago(364 * DAY), NOW)).toBe("11 months ago");
    expect(formatRelativeTime(ago(365 * DAY), NOW)).toBe("1 year ago");
    expect(formatRelativeTime(ago(800 * DAY), NOW)).toBe("2 years ago");
  });

  it("returns null (never an invented time) for missing or invalid timestamps", () => {
    expect(formatRelativeTime(null, NOW)).toBeNull();
    expect(formatRelativeTime(undefined, NOW)).toBeNull();
    expect(formatRelativeTime("", NOW)).toBeNull();
    expect(formatRelativeTime("   ", NOW)).toBeNull();
    expect(formatRelativeTime("not a date", NOW)).toBeNull();
    expect(formatRelativeTime(new Date("nope"), NOW)).toBeNull();
    expect(formatRelativeTime(Number.NaN, NOW)).toBeNull();
  });

  it("is timezone independent: the same instant gives the same text however it is written", () => {
    const instant = "2025-06-15T09:00:00Z"; // 3 h before NOW
    expect(formatRelativeTime(instant, NOW)).toBe("3 hours ago");
    expect(formatRelativeTime("2025-06-15T15:00:00+06:00", NOW)).toBe("3 hours ago"); // same instant, UTC+6
    expect(formatRelativeTime("2025-06-15T04:00:00-05:00", NOW)).toBe("3 hours ago"); // same instant, UTC-5
    expect(formatRelativeTime(Date.parse(instant), NOW)).toBe("3 hours ago");
    expect(formatRelativeTime(new Date(instant), NOW)).toBe("3 hours ago");
  });

  it("treats a zone-less database timestamp as UTC (never as the viewer's local time)", () => {
    expect(formatRelativeTime("2025-06-15 09:00:00", NOW)).toBe("3 hours ago");
    expect(formatRelativeTime("2025-06-15T09:00:00", NOW)).toBe("3 hours ago");
    expect(formatRelativeTime("2025-06-15T09:00:00.000000", NOW)).toBe("3 hours ago");
  });
});

describe("parseTimestamp / formatAbsoluteDate", () => {
  it("parses valid values and rejects invalid ones", () => {
    expect(parseTimestamp("2025-06-15T09:00:00Z")).toBe(Date.parse("2025-06-15T09:00:00Z"));
    expect(parseTimestamp("garbage")).toBeNull();
    expect(parseTimestamp(null)).toBeNull();
  });
  it("gives a readable absolute date only for valid input", () => {
    expect(formatAbsoluteDate("2025-06-15T09:00:00Z")).toMatch(/2025/);
    expect(formatAbsoluteDate("garbage")).toBeNull();
  });
});
