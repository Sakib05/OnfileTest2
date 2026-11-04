import crypto from "crypto";
import { usagePercents } from "./status";
import type { ProviderKey, ProviderStatus, StorageSettings, TermsStatus } from "./types";

export interface AllocationCandidate {
  providerKey: ProviderKey;
  providerId: number;
  enabled: boolean;
  /** All required credentials present. */
  configured: boolean;
  status: ProviderStatus;
  termsStatus: TermsStatus;
  /** Admin-assigned base weight (>=0). */
  weight: number;
  maxAssets: number | null;
  assetCount: number;
  storageQuota: number | null;
  storageUsed: number;
  bandwidthQuota: number | null;
  bandwidthUsed: number;
  requestQuota: number | null;
  requestUsed: number;
  consecutiveUploadFailures: number;
  consecutiveDeliveryFailures: number;
}

export interface RankedProvider {
  providerKey: ProviderKey;
  weight: number;
  probability: number;
  factors: Record<string, number>;
}

export interface AllocationResult {
  /** Failover order: first = chosen primary. Empty => nothing eligible. */
  order: ProviderKey[];
  chosen: ProviderKey | null;
  seed: string;
  ranked: RankedProvider[];
  excluded: { providerKey: ProviderKey; reasons: string[] }[];
  /** Human-readable explanation, safe to log and store. */
  summary: string;
}

export interface AllocationOptions {
  assetBytes: number;
  seed: string;
  exclude?: ProviderKey[];
}

function mulberry32(seedInt: number): () => number {
  let a = seedInt >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededRandom(seed: string): () => number {
  const h = crypto.createHash("sha256").update(seed).digest();
  return mulberry32(h.readUInt32BE(0));
}

function headroomFrac(used: number, quota: number, margin: number, extra = 0): number {
  const eff = quota * (1 - margin);
  if (eff <= 0) return 0;
  return Math.max(0, Math.min(1, (eff - used - extra) / eff));
}

/**
 * Dynamic weighted allocation (NOT a fixed 25% split).
 *
 *   eligibility  : enabled, configured, status ACTIVE|NEAR_LIMIT, terms != PROHIBITED,
 *                  known storage AND bandwidth quota, usage below the critical threshold,
 *                  room for this object after the safety margin, asset cap not reached.
 *   weight       : adminWeight × minHeadroom × capacity × warnFactor × healthFactor
 *       minHeadroom  = smallest remaining fraction across storage / bandwidth / requests (each separate)
 *       capacity     = 0.25 + 0.75 × (storage room / largest storage room among candidates)
 *       warnFactor   = nearLimitWeightFactor when NEAR_LIMIT or any metric >= warn%
 *       healthFactor = 1 / (1 + consecutive upload failures + consecutive delivery failures)
 *
 * The primary is drawn with a seeded PRNG (seed is recorded), then remaining
 * providers are drawn without replacement to form the failover order. The
 * same inputs + seed always give the same result, so decisions can be replayed.
 */
export function allocate(candidates: AllocationCandidate[], settings: StorageSettings, opts: AllocationOptions): AllocationResult {
  const margin = settings.safetyMarginPercent / 100;
  const excluded: AllocationResult["excluded"] = [];
  const eligible: AllocationCandidate[] = [];
  const sorted = [...candidates].sort((a, b) => a.providerKey.localeCompare(b.providerKey));

  for (const c of sorted) {
    const reasons: string[] = [];
    if (opts.exclude?.includes(c.providerKey)) reasons.push("excluded_by_caller");
    if (!c.enabled) reasons.push("disabled");
    if (!c.configured) reasons.push("not_configured");
    if (c.termsStatus === "PROHIBITED") reasons.push("commercial_terms_prohibited");
    if (c.status === "EXHAUSTED" || c.status === "DRAINING" || c.status === "DISABLED" || c.status === "ERROR") {
      reasons.push(`status_${c.status}`);
    }
    if (c.storageQuota === null || c.storageQuota <= 0) reasons.push("unknown_storage_quota");
    if (c.bandwidthQuota === null || c.bandwidthQuota <= 0) reasons.push("unknown_bandwidth_quota");
    if (c.weight <= 0) reasons.push("weight_zero");
    if (c.maxAssets !== null && c.assetCount >= c.maxAssets) reasons.push("max_assets_reached");

    if (!reasons.length) {
      const p = usagePercents(c);
      if (p.max !== null && p.max >= settings.criticalPercent) reasons.push(`usage_at_critical_${Math.round(p.max)}pct`);
      if (c.storageQuota && c.storageUsed + opts.assetBytes > c.storageQuota * (1 - margin)) reasons.push("insufficient_storage_headroom");
      if (c.bandwidthQuota && c.bandwidthUsed >= c.bandwidthQuota * (1 - margin)) reasons.push("insufficient_bandwidth_headroom");
      if (c.requestQuota && c.requestUsed >= c.requestQuota * (1 - margin)) reasons.push("insufficient_request_headroom");
    }

    if (reasons.length) excluded.push({ providerKey: c.providerKey, reasons });
    else eligible.push(c);
  }

  const maxRoom = Math.max(1, ...eligible.map((c) => (c.storageQuota ?? 0) * (1 - margin) - c.storageUsed));
  const weighted = eligible.map((c) => {
    const fracs = [
      headroomFrac(c.storageUsed, c.storageQuota as number, margin, opts.assetBytes),
      headroomFrac(c.bandwidthUsed, c.bandwidthQuota as number, margin),
    ];
    if (c.requestQuota && c.requestQuota > 0) fracs.push(headroomFrac(c.requestUsed, c.requestQuota, margin));
    const minHeadroom = Math.min(...fracs);
    const room = Math.max(0, (c.storageQuota as number) * (1 - margin) - c.storageUsed);
    const capacity = 0.25 + 0.75 * Math.min(1, room / maxRoom);
    const p = usagePercents(c);
    const warn = c.status === "NEAR_LIMIT" || (p.max !== null && p.max >= settings.warnPercent) ? settings.nearLimitWeightFactor : 1;
    const health = 1 / (1 + c.consecutiveUploadFailures + c.consecutiveDeliveryFailures);
    const weight = c.weight * minHeadroom * capacity * warn * health;
    return { c, weight, factors: { adminWeight: c.weight, minHeadroom, capacity, warnFactor: warn, healthFactor: health } };
  });

  const positive = weighted.filter((w) => w.weight > 0);
  for (const w of weighted) {
    if (w.weight <= 0) excluded.push({ providerKey: w.c.providerKey, reasons: ["no_effective_weight"] });
  }
  const total = positive.reduce((s, w) => s + w.weight, 0);
  const ranked: RankedProvider[] = positive
    .map((w) => ({ providerKey: w.c.providerKey, weight: round(w.weight), probability: round(total ? w.weight / total : 0), factors: roundObj(w.factors) }))
    .sort((a, b) => b.weight - a.weight || a.providerKey.localeCompare(b.providerKey));

  // Weighted draw without replacement -> failover order.
  const rng = seededRandom(opts.seed);
  const pool = [...positive];
  const order: ProviderKey[] = [];
  while (pool.length) {
    const sum = pool.reduce((s, w) => s + w.weight, 0);
    let r = rng() * sum;
    let idx = pool.findIndex((w) => {
      r -= w.weight;
      return r < 0;
    });
    if (idx < 0) idx = pool.length - 1;
    order.push(pool[idx].c.providerKey);
    pool.splice(idx, 1);
  }

  const chosen = order[0] ?? null;
  const summary = chosen
    ? `selected ${chosen} (p=${ranked.find((r) => r.providerKey === chosen)?.probability}) among [${ranked
        .map((r) => `${r.providerKey}:${r.probability}`)
        .join(", ")}]; excluded [${excluded.map((e) => `${e.providerKey}:${e.reasons.join("+")}`).join(", ") || "none"}]; seed=${opts.seed}`
    : `no eligible provider; excluded [${excluded.map((e) => `${e.providerKey}:${e.reasons.join("+")}`).join(", ")}]`;

  return { order, chosen, seed: opts.seed, ranked, excluded, summary };
}

function round(n: number): number {
  return Math.round(n * 10000) / 10000;
}
function roundObj(o: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, round(v)]));
}
