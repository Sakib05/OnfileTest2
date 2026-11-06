import type { UsageThresholds } from "./config";

export const USAGE_METRICS = ["storage_bytes", "bandwidth_bytes", "requests"] as const;
export type UsageMetric = (typeof USAGE_METRICS)[number];
export type UsageLevel = "ok" | "warning" | "high" | "restricted" | "full";

const ORDER: UsageLevel[] = ["ok", "warning", "high", "restricted", "full"];

export function levelRank(l: UsageLevel): number {
  return ORDER.indexOf(l);
}

export function maxLevel(levels: UsageLevel[]): UsageLevel {
  return levels.reduce<UsageLevel>((a, b) => (levelRank(b) > levelRank(a) ? b : a), "ok");
}

/** pct = used / limit * 100. Unknown/invalid limit -> null. */
export function usagePercent(used: number, limit: number): number | null {
  if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0 || used < 0) return null;
  return (used / limit) * 100;
}

export function usageLevel(pct: number | null, t: UsageThresholds): UsageLevel {
  if (pct === null) return "ok";
  if (pct >= 100) return "full";
  if (pct >= t.block) return "restricted";
  if (pct >= t.high) return "high";
  if (pct >= t.warn) return "warning";
  return "ok";
}

/** At `restricted` (default 90%) and above, NEW uploads are refused. Viewing and deleting are unaffected. */
export function uploadsBlocked(level: UsageLevel): boolean {
  return levelRank(level) >= levelRank("restricted");
}
