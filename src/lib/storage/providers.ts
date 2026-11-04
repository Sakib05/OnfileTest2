import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { storageProviders, thumbnailAssets } from "@/db/schema";
import type { AllocationCandidate } from "./allocation";
import { raiseAlert, logEvent } from "./alerts";
import { getAdapter } from "./adapters";
import { getSettings } from "./settings";
import { evaluateStatus } from "./status";
import {
  PROVIDER_KEYS,
  PROVIDER_LABELS,
  ProviderError,
  type ProviderKey,
  type ProviderStatus,
  type StorageSettings,
  type TermsStatus,
  type UsageSource,
} from "./types";

export type ProviderRow = typeof storageProviders.$inferSelect;

export type MetricSources = { storage: UsageSource; bandwidth: UsageSource; requests: UsageSource };

const SOURCE_RANK: Record<UsageSource, number> = { OFFICIAL_API: 3, MANUAL: 2, ESTIMATED: 1, UNKNOWN: 0 };

/** Least reliable source across the tracked metrics. */
export function overallUsageSource(s: MetricSources): UsageSource {
  const list = [s.storage, s.bandwidth, s.requests];
  return list.reduce((a, b) => (SOURCE_RANK[b] < SOURCE_RANK[a] ? b : a));
}

export function readMetricSources(row: Pick<ProviderRow, "usageDetails">): MetricSources {
  const d = (row.usageDetails ?? {}) as { metricSources?: Partial<MetricSources> };
  return {
    storage: d.metricSources?.storage ?? "UNKNOWN",
    bandwidth: d.metricSources?.bandwidth ?? "UNKNOWN",
    requests: d.metricSources?.requests ?? "UNKNOWN",
  };
}

function envInt(env: Record<string, string | undefined>, name: string): number | null {
  const raw = env[name]?.trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

/**
 * Creates any missing provider rows. Quotas are seeded ONCE from env vars
 * (`<PROVIDER>_STORAGE_QUOTA_BYTES`, `_BANDWIDTH_QUOTA_BYTES`, `_REQUEST_QUOTA`,
 * `_BILLING_CYCLE_DAY`); afterwards the admin dashboard is authoritative.
 * DBByte falls back to the dashboard values the owner observed (20 GB storage,
 * 100 GB/month bandwidth, 10K requests/month) labelled MANUAL — these are NOT
 * guaranteed entitlements.
 */
export async function ensureProviders(env: Record<string, string | undefined> = process.env): Promise<void> {
  const existing = await db.select({ key: storageProviders.providerKey }).from(storageProviders);
  const have = new Set(existing.map((r) => r.key));
  for (const key of PROVIDER_KEYS) {
    if (have.has(key)) continue;
    const prefix = key.toUpperCase();
    let storageQuota = envInt(env, `${prefix}_STORAGE_QUOTA_BYTES`);
    let bandwidthQuota = envInt(env, `${prefix}_BANDWIDTH_QUOTA_BYTES`);
    let requestQuota = envInt(env, `${prefix}_REQUEST_QUOTA`);
    const quotaOrigin: string[] = [];
    if (storageQuota !== null || bandwidthQuota !== null || requestQuota !== null) quotaOrigin.push("env");
    if (key === "dbbyte" && storageQuota === null && bandwidthQuota === null && requestQuota === null) {
      storageQuota = 20_000_000_000;
      bandwidthQuota = 100_000_000_000;
      requestQuota = 10_000;
      quotaOrigin.push("user-observed DBByte dashboard values (not guaranteed; verify)");
    }
    const hasQuota = storageQuota !== null || bandwidthQuota !== null || requestQuota !== null;
    const cycle = envInt(env, `${prefix}_BILLING_CYCLE_DAY`);
    const manual: UsageSource = hasQuota ? "MANUAL" : "UNKNOWN";
    await db
      .insert(storageProviders)
      .values({
        providerKey: key,
        storageQuota,
        bandwidthQuota,
        requestQuota,
        billingCycleDay: cycle && cycle >= 1 && cycle <= 28 ? cycle : null,
        commercialTermsNote:
          "Terms not independently reviewed by the build. Review the provider's current terms, then set PERMITTED / AMBIGUOUS / PROHIBITED.",
        usageSource: "UNKNOWN",
        usageDetails: {
          metricSources: { storage: "UNKNOWN", bandwidth: "UNKNOWN", requests: "UNKNOWN" },
          quotaSource: hasQuota ? manual : "UNKNOWN",
          quotaOrigin,
        },
      })
      .onConflictDoNothing();
  }
}

export async function listProviders(): Promise<ProviderRow[]> {
  return db.select().from(storageProviders).orderBy(storageProviders.id);
}

export async function getProviderByKey(key: ProviderKey): Promise<ProviderRow | null> {
  const [row] = await db.select().from(storageProviders).where(eq(storageProviders.providerKey, key)).limit(1);
  return row ?? null;
}

export async function getProviderById(id: number): Promise<ProviderRow | null> {
  const [row] = await db.select().from(storageProviders).where(eq(storageProviders.id, id)).limit(1);
  return row ?? null;
}

export async function getAssetStats(): Promise<Map<number, { count: number; bytes: number }>> {
  const rows = await db
    .select({
      providerId: thumbnailAssets.providerId,
      count: sql<number>`count(*)::int`,
      bytes: sql<number>`coalesce(sum(${thumbnailAssets.fileSize}), 0)::bigint`,
    })
    .from(thumbnailAssets)
    .where(eq(thumbnailAssets.status, "active"))
    .groupBy(thumbnailAssets.providerId);
  return new Map(rows.map((r) => [r.providerId, { count: Number(r.count), bytes: Number(r.bytes) }]));
}

export function toCandidate(row: ProviderRow, assetCount: number): AllocationCandidate {
  const key = row.providerKey as ProviderKey;
  return {
    providerKey: key,
    providerId: row.id,
    enabled: row.enabled,
    configured: getAdapter(key).isConfigured(),
    status: row.status as ProviderStatus,
    termsStatus: row.commercialTermsStatus as TermsStatus,
    weight: Number(row.weight),
    maxAssets: row.maxAssets,
    assetCount,
    storageQuota: row.storageQuota,
    storageUsed: row.storageUsed,
    bandwidthQuota: row.bandwidthQuota,
    bandwidthUsed: row.bandwidthUsed,
    requestQuota: row.requestQuota,
    requestUsed: row.requestUsed,
    consecutiveUploadFailures: row.consecutiveUploadFailures,
    consecutiveDeliveryFailures: row.consecutiveDeliveryFailures,
  };
}

export async function loadCandidates(): Promise<{ rows: ProviderRow[]; candidates: AllocationCandidate[] }> {
  const rows = await listProviders();
  const stats = await getAssetStats();
  return { rows, candidates: rows.map((r) => toCandidate(r, stats.get(r.id)?.count ?? 0)) };
}

/** Atomic counter adjustments (storage/bandwidth bytes, request counts). */
export async function recordUsageDelta(
  providerId: number,
  delta: { storage?: number; bandwidth?: number; requests?: number }
): Promise<void> {
  const s = delta.storage ?? 0;
  const b = delta.bandwidth ?? 0;
  const r = delta.requests ?? 0;
  if (!s && !b && !r) return;
  await db
    .update(storageProviders)
    .set({
      storageUsed: sql`greatest(0, ${storageProviders.storageUsed} + ${s})`,
      bandwidthUsed: sql`greatest(0, ${storageProviders.bandwidthUsed} + ${b})`,
      requestUsed: sql`greatest(0, ${storageProviders.requestUsed} + ${r})`,
      updatedAt: new Date(),
    })
    .where(eq(storageProviders.id, providerId));
}

export type ErrorContext = "upload" | "delivery" | "migration" | "delete";

/**
 * Classifies a provider failure and updates provider state:
 *   401/403  -> ERROR           (never treated as quota exhaustion)
 *   quota    -> EXHAUSTED       (new uploads stop; maintenance schedules migration)
 *   others   -> failure counters that reduce allocation weight and trigger
 *               a de-duplicated "repeated failures" alert
 */
export async function handleProviderError(row: ProviderRow, err: unknown, ctx: ErrorContext): Promise<void> {
  const key = row.providerKey as ProviderKey;
  const label = PROVIDER_LABELS[key] ?? key;
  const message = err instanceof Error ? err.message : "unknown error";
  const kind = err instanceof ProviderError ? err.kind : "unknown";

  if (kind === "auth") {
    await db
      .update(storageProviders)
      .set({ status: "ERROR", healthOk: false, errorDetails: `[${ctx}] ${message}`, updatedAt: new Date() })
      .where(eq(storageProviders.id, row.id));
    await raiseAlert({
      providerId: row.id,
      eventType: "auth_failure",
      severity: "critical",
      message: `${label}: authentication/authorisation failure during ${ctx}. Provider set to ERROR — check credentials.`,
      details: { context: ctx },
      dedupeKey: `provider:${key}:auth`,
    });
    return;
  }

  if (kind === "quota") {
    await db
      .update(storageProviders)
      .set({
        status: row.status === "DISABLED" || row.status === "DRAINING" || row.status === "ERROR" ? row.status : "EXHAUSTED",
        quotaErrorAt: new Date(),
        errorDetails: `[${ctx}] ${message}`,
        updatedAt: new Date(),
      })
      .where(eq(storageProviders.id, row.id));
    await raiseAlert({
      providerId: row.id,
      eventType: "quota_exhausted",
      severity: "error",
      message: `${label}: quota exceeded (${ctx}). New uploads stopped; migration will be scheduled.`,
      details: { context: ctx },
      dedupeKey: `provider:${key}:quota`,
    });
    return;
  }

  const column = ctx === "delivery" ? "consecutiveDeliveryFailures" : "consecutiveUploadFailures";
  const [updated] = await db
    .update(storageProviders)
    .set({
      [column]: sql`${storageProviders[column]} + 1`,
      errorDetails: `[${ctx}/${kind}] ${message}`,
      updatedAt: new Date(),
    })
    .where(eq(storageProviders.id, row.id))
    .returning();

  await logEvent({
    providerId: row.id,
    eventType: `${ctx}_failure`,
    severity: "warning",
    message: `${label}: ${ctx} failed (${kind}): ${message}`,
    details: { kind, status: err instanceof ProviderError ? err.status ?? null : null },
  });

  const settings = await getSettings();
  const count = ctx === "delivery" ? updated?.consecutiveDeliveryFailures : updated?.consecutiveUploadFailures;
  if (count !== undefined && count >= settings.repeatedFailureThreshold) {
    await raiseAlert({
      providerId: row.id,
      eventType: "repeated_failures",
      severity: "warning",
      message: `${label}: ${count} consecutive ${ctx} failures (last: ${kind}).`,
      dedupeKey: `provider:${key}:repeated_${ctx}`,
    });
  }
}

export async function markProviderSuccess(providerId: number, ctx: "upload" | "delivery"): Promise<void> {
  const column = ctx === "delivery" ? storageProviders.consecutiveDeliveryFailures : storageProviders.consecutiveUploadFailures;
  const name = ctx === "delivery" ? "consecutiveDeliveryFailures" : "consecutiveUploadFailures";
  await db
    .update(storageProviders)
    .set({ [name]: 0 })
    .where(and(eq(storageProviders.id, providerId), sql`${column} > 0`));
}

/** Delivery accounting: estimated bandwidth + one request, plus success/failure bookkeeping. */
export async function recordDelivery(row: ProviderRow, bytes: number): Promise<void> {
  await recordUsageDelta(row.id, { bandwidth: bytes, requests: 1 });
  await markProviderSuccess(row.id, "delivery");
}

/**
 * Re-evaluates a provider's status from its current usage and records /
 * alerts on transitions. Sticky states (DISABLED, DRAINING, ERROR) are kept.
 */
export async function applyStatusEvaluation(
  providerId: number,
  settingsArg?: StorageSettings,
  now: Date = new Date()
): Promise<{ changed: boolean; status: ProviderStatus; reason: string }> {
  const row = await getProviderById(providerId);
  if (!row) throw new Error("provider_not_found");
  const settings = settingsArg ?? (await getSettings());
  const evaluation = evaluateStatus(
    {
      enabled: row.enabled,
      status: row.status as ProviderStatus,
      quotaErrorAt: row.quotaErrorAt,
      billingPeriodStart: row.billingPeriodStart,
      storageQuota: row.storageQuota,
      storageUsed: row.storageUsed,
      bandwidthQuota: row.bandwidthQuota,
      bandwidthUsed: row.bandwidthUsed,
      requestQuota: row.requestQuota,
      requestUsed: row.requestUsed,
    },
    settings,
    now
  );
  if (evaluation.status === row.status) return { changed: false, status: evaluation.status, reason: evaluation.reason };

  await db
    .update(storageProviders)
    .set({ status: evaluation.status, updatedAt: new Date() })
    .where(eq(storageProviders.id, providerId));

  const key = row.providerKey as ProviderKey;
  const label = PROVIDER_LABELS[key] ?? key;
  const severity = evaluation.status === "EXHAUSTED" ? "error" : evaluation.status === "NEAR_LIMIT" ? "warning" : "info";
  await raiseAlert({
    providerId,
    eventType: `status_${evaluation.status.toLowerCase()}`,
    severity,
    message: `${label}: status ${row.status} → ${evaluation.status} (${evaluation.reason}).`,
    details: { from: row.status, to: evaluation.status },
    dedupeKey: evaluation.status === "ACTIVE" || evaluation.status === "DISABLED" ? undefined : `provider:${key}:${evaluation.status}`,
    notify: evaluation.status === "NEAR_LIMIT" || evaluation.status === "EXHAUSTED",
  });
  return { changed: true, status: evaluation.status, reason: evaluation.reason };
}
