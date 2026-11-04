import type { ProviderStatus, StorageSettings } from "./types";

export interface UsageView {
  storageQuota: number | null;
  storageUsed: number;
  bandwidthQuota: number | null;
  bandwidthUsed: number;
  requestQuota: number | null;
  requestUsed: number;
}

export interface UsagePercents {
  storage: number | null;
  bandwidth: number | null;
  requests: number | null;
  /** Highest known percentage (null when no quota is known at all). */
  max: number | null;
}

function pct(used: number, quota: number | null): number | null {
  if (quota === null || quota === undefined || quota <= 0) return null;
  return (used / quota) * 100;
}

/** Storage, bandwidth and request quotas are tracked separately — never interchangeable. */
export function usagePercents(u: UsageView): UsagePercents {
  const storage = pct(u.storageUsed, u.storageQuota);
  const bandwidth = pct(u.bandwidthUsed, u.bandwidthQuota);
  const requests = pct(u.requestUsed, u.requestQuota);
  const known = [storage, bandwidth, requests].filter((v): v is number => v !== null);
  return { storage, bandwidth, requests, max: known.length ? Math.max(...known) : null };
}

export interface StatusInput extends UsageView {
  enabled: boolean;
  status: ProviderStatus;
  quotaErrorAt: Date | null;
  billingPeriodStart: Date | null;
}

export interface StatusEvaluation {
  status: ProviderStatus;
  reason: string;
}

/**
 * Pure status evaluation.
 *  - disabled flag      -> DISABLED (admin decision)
 *  - DRAINING / ERROR   -> sticky; cleared explicitly by an admin / successful health check
 *  - provider quota err -> EXHAUSTED until the billing period rolls over (or 24h when unknown)
 *  - usage >= critical  -> EXHAUSTED (default 90%)
 *  - usage >= warn      -> NEAR_LIMIT (default 80%)
 */
export function evaluateStatus(input: StatusInput, settings: StorageSettings, now: Date = new Date()): StatusEvaluation {
  if (!input.enabled || input.status === "DISABLED") return { status: "DISABLED", reason: "disabled by administrator" };
  if (input.status === "DRAINING") return { status: "DRAINING", reason: "draining (manual)" };
  if (input.status === "ERROR") return { status: "ERROR", reason: "operational/authentication/connectivity error" };

  if (input.quotaErrorAt) {
    const since = input.billingPeriodStart ?? new Date(now.getTime() - 24 * 3600 * 1000);
    if (input.quotaErrorAt.getTime() > since.getTime()) {
      return { status: "EXHAUSTED", reason: "provider reported quota exceeded" };
    }
  }

  const p = usagePercents(input);
  if (p.max !== null) {
    const worst = (["storage", "bandwidth", "requests"] as const)
      .filter((k) => p[k] === p.max)
      .map((k) => `${k} ${Math.round(p.max as number)}%`)
      .join(", ");
    if (p.max >= settings.criticalPercent) return { status: "EXHAUSTED", reason: `usage at/over ${settings.criticalPercent}% (${worst})` };
    if (p.max >= settings.warnPercent) return { status: "NEAR_LIMIT", reason: `usage at/over ${settings.warnPercent}% (${worst})` };
  }
  return { status: "ACTIVE", reason: "within limits" };
}

/**
 * Next billing period start for a provider whose renewal day is known.
 * Returns null when the cycle day is unknown (=> counters must NOT auto-reset).
 */
export function currentPeriodStart(cycleDay: number | null, now: Date = new Date()): Date | null {
  if (!cycleDay || cycleDay < 1 || cycleDay > 28) return null;
  const thisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), cycleDay));
  if (thisMonth.getTime() <= now.getTime()) return thisMonth;
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, cycleDay));
}
