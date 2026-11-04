import crypto from "crypto";
import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { providerUsageHistory, storageProviderEvents, storageProviders, thumbnailAssets } from "@/db/schema";
import { allocate } from "./allocation";
import { getAdapter } from "./adapters";
import { logEvent, raiseAlert } from "./alerts";
import { enqueueMigrations, processDueMigrations, requeueStaleJobs, type MigrationDeps } from "./migration";
import {
  applyStatusEvaluation,
  ensureProviders,
  getAssetStats,
  handleProviderError,
  listProviders,
  loadCandidates,
  overallUsageSource,
  readMetricSources,
  type ProviderRow,
} from "./providers";
import { getSettings } from "./settings";
import { purgeAssetsBatch } from "./thumbnails";
import { currentPeriodStart, usagePercents } from "./status";
import { PROVIDER_LABELS, type ProviderKey, type UsageSource } from "./types";

// ─── Locking (prevents concurrent maintenance runs; pooler-safe) ───────────

export async function acquireLock(name: string, holder: string, ttlSeconds: number): Promise<boolean> {
  const res = await db.execute(sql`
    INSERT INTO storage_locks (name, holder, locked_until)
    VALUES (${name}, ${holder}, now() + make_interval(secs => ${ttlSeconds}))
    ON CONFLICT (name) DO UPDATE
      SET holder = ${holder}, locked_until = now() + make_interval(secs => ${ttlSeconds})
      WHERE storage_locks.locked_until < now()
    RETURNING holder
  `);
  return res.rows.length > 0;
}

export async function releaseLock(name: string, holder: string): Promise<void> {
  await db.execute(sql`DELETE FROM storage_locks WHERE name = ${name} AND holder = ${holder}`);
}

// ─── Health ────────────────────────────────────────────────────────────────

const HEALTH_FAILURES_BEFORE_ERROR = 2;

export async function runHealthCheck(row: ProviderRow, opts: { deep?: boolean } = {}) {
  const key = row.providerKey as ProviderKey;
  const adapter = getAdapter(key);
  const label = PROVIDER_LABELS[key];
  if (!adapter.isConfigured()) {
    await db
      .update(storageProviders)
      .set({ healthOk: null, lastHealthCheck: new Date(), errorDetails: "not configured (missing environment variables)", updatedAt: new Date() })
      .where(eq(storageProviders.id, row.id));
    return { ok: false, configured: false as const, detail: "not configured" };
  }
  const result = await adapter.checkHealth({ deep: opts.deep });
  const details = { ...(row.usageDetails ?? {}) } as Record<string, unknown>;
  const prevFailures = typeof details.healthFailures === "number" ? details.healthFailures : 0;
  const now = new Date();

  if (result.ok) {
    details.healthFailures = 0;
    const recovering = row.status === "ERROR";
    await db
      .update(storageProviders)
      .set({
        healthOk: true,
        lastHealthCheck: now,
        status: recovering ? "ACTIVE" : row.status,
        errorDetails: recovering ? null : row.errorDetails,
        usageDetails: details,
        updatedAt: now,
      })
      .where(eq(storageProviders.id, row.id));
    if (recovering) {
      await raiseAlert({ providerId: row.id, eventType: "provider_recovered", severity: "info", message: `${label}: health check passed — provider recovered.`, notify: true, dedupeKey: `provider:${key}:recovered`, cooldownMinutes: 30 });
      await applyStatusEvaluation(row.id);
    }
    return { ok: true, configured: true as const, latencyMs: result.latencyMs };
  }

  const failures = prevFailures + 1;
  details.healthFailures = failures;
  const toError = result.authFailure || failures >= HEALTH_FAILURES_BEFORE_ERROR;
  await db
    .update(storageProviders)
    .set({
      healthOk: false,
      lastHealthCheck: now,
      errorDetails: `[health] ${result.detail ?? "unhealthy"}`,
      status: toError && row.status !== "DISABLED" && row.status !== "DRAINING" ? "ERROR" : row.status,
      usageDetails: details,
      updatedAt: now,
    })
    .where(eq(storageProviders.id, row.id));
  if (toError) {
    await raiseAlert({
      providerId: row.id,
      eventType: result.authFailure ? "auth_failure" : "provider_down",
      severity: result.authFailure ? "critical" : "error",
      message: result.authFailure
        ? `${label}: authentication failed during health check. Provider set to ERROR — check credentials.`
        : `${label}: unreachable/unhealthy (${failures} consecutive failed checks): ${result.detail ?? ""}`,
      dedupeKey: result.authFailure ? `provider:${key}:auth` : `provider:${key}:down`,
    });
  } else {
    await logEvent({ providerId: row.id, eventType: "health_check_failed", severity: "warning", message: `${label}: health check failed (${result.detail ?? "unknown"}). Will mark ERROR if it persists.` });
  }
  return { ok: false, configured: true as const, detail: result.detail, authFailure: result.authFailure };
}

// ─── Usage sync / billing period ───────────────────────────────────────────

export async function rolloverBillingPeriod(row: ProviderRow, now: Date): Promise<boolean> {
  const start = currentPeriodStart(row.billingCycleDay, now);
  if (!start) return false; // cycle unknown -> never auto-reset
  if (!row.billingPeriodStart) {
    await db.update(storageProviders).set({ billingPeriodStart: start }).where(eq(storageProviders.id, row.id));
    return false;
  }
  if (row.billingPeriodStart.getTime() >= start.getTime()) return false;
  const sources = readMetricSources(row);
  await db
    .update(storageProviders)
    .set({
      billingPeriodStart: start,
      bandwidthUsed: sources.bandwidth === "OFFICIAL_API" ? row.bandwidthUsed : 0,
      requestUsed: sources.requests === "OFFICIAL_API" ? row.requestUsed : 0,
      quotaErrorAt: null,
      updatedAt: now,
    })
    .where(eq(storageProviders.id, row.id));
  await logEvent({
    providerId: row.id,
    eventType: "billing_period_rollover",
    severity: "info",
    message: `${PROVIDER_LABELS[row.providerKey as ProviderKey]}: billing period renewed (cycle day ${row.billingCycleDay}); estimated/manual bandwidth & request counters reset.`,
  });
  return true;
}

export async function syncProviderUsage(rowIn: ProviderRow, now: Date = new Date()): Promise<{ synced: boolean; note?: string }> {
  const key = rowIn.providerKey as ProviderKey;
  const adapter = getAdapter(key);
  await rolloverBillingPeriod(rowIn, now);
  const [row] = await db.select().from(storageProviders).where(eq(storageProviders.id, rowIn.id)).limit(1);
  if (!row) return { synced: false, note: "provider_missing" };

  const sources = readMetricSources(row);
  const details = { ...(row.usageDetails ?? {}) } as Record<string, unknown>;
  const manual = (details.manual ?? {}) as { storage?: boolean; bandwidth?: boolean; requests?: boolean };
  const set: Partial<typeof storageProviders.$inferInsert> = {};
  let note: string | undefined;

  if (adapter.isConfigured()) {
    try {
      const usage = await adapter.getUsage({ periodStart: row.billingPeriodStart ?? undefined });
      if (usage.supported) {
        const u = usage.value;
        if (u.storageBytes !== undefined && !manual.storage) {
          set.storageUsed = Math.round(u.storageBytes);
          sources.storage = "OFFICIAL_API";
        }
        if (u.bandwidthBytes !== undefined && !manual.bandwidth) {
          set.bandwidthUsed = Math.round(u.bandwidthBytes);
          sources.bandwidth = "OFFICIAL_API";
        }
        if (u.requests !== undefined && !manual.requests) {
          set.requestUsed = Math.round(u.requests);
          sources.requests = "OFFICIAL_API";
        }
        if (row.storageQuota === null && u.storageQuotaBytes) set.storageQuota = Math.round(u.storageQuotaBytes);
        if (row.bandwidthQuota === null && u.bandwidthQuotaBytes) set.bandwidthQuota = Math.round(u.bandwidthQuotaBytes);
        if (row.requestQuota === null && u.requestQuota) set.requestQuota = Math.round(u.requestQuota);
        details.officialExtra = u.extra ?? null;
        details.bandwidthBreakdown =
          u.bandwidthCachedBytes !== undefined || u.bandwidthUncachedBytes !== undefined
            ? { cachedBytes: u.bandwidthCachedBytes ?? null, uncachedBytes: u.bandwidthUncachedBytes ?? null }
            : { note: "provider does not report cached vs uncached bandwidth separately" };
        details.lastUsageError = null;
      } else {
        note = usage.reason;
        details.usageUnsupportedReason = usage.reason;
      }
    } catch (err) {
      note = err instanceof Error ? err.message : "usage sync failed";
      details.lastUsageError = note;
      await handleProviderError(row, err, "upload").catch(() => {});
    }
  } else {
    note = "provider not configured";
  }

  // Fallbacks: never fabricate precision — label as ESTIMATED / MANUAL / UNKNOWN.
  if (sources.storage !== "OFFICIAL_API") {
    if (manual.storage) sources.storage = "MANUAL";
    else {
      const stats = (await getAssetStats()).get(row.id);
      set.storageUsed = stats?.bytes ?? 0;
      sources.storage = "ESTIMATED";
    }
  }
  for (const [metric, used] of [
    ["bandwidth", set.bandwidthUsed ?? row.bandwidthUsed],
    ["requests", set.requestUsed ?? row.requestUsed],
  ] as const) {
    if (sources[metric] === "OFFICIAL_API") continue;
    if (manual[metric]) sources[metric] = "MANUAL";
    else sources[metric] = (used as number) > 0 ? "ESTIMATED" : "UNKNOWN";
  }

  details.metricSources = sources;
  const overall: UsageSource = overallUsageSource(sources);
  await db
    .update(storageProviders)
    .set({ ...set, usageSource: overall, usageDetails: details, lastUsageSync: now, updatedAt: now })
    .where(eq(storageProviders.id, row.id));
  await db.insert(providerUsageHistory).values({
    providerId: row.id,
    storageUsed: set.storageUsed ?? row.storageUsed,
    bandwidthUsed: set.bandwidthUsed ?? row.bandwidthUsed,
    requestUsed: set.requestUsed ?? row.requestUsed,
    source: overall,
    details: { metricSources: sources },
    measuredAt: now,
  });
  return { synced: true, note };
}

// ─── Orchestrator ──────────────────────────────────────────────────────────

export interface MaintenanceReport {
  skipped?: "locked";
  startedAt: string;
  durationMs: number;
  providers: { key: string; health?: string; status?: string; usageNote?: string }[];
  migrationsEnqueued: number;
  migrationsProcessed: { completed: number; retried: number; failed: number; cancelled: number };
  orphansPurged: number;
  cleaned: Record<string, number>;
  systemWarnings: string[];
}

const LOCK_NAME = "storage-maintenance";

export async function runMaintenance(
  opts: { deadlineMs?: number; migrationDeps?: MigrationDeps; now?: Date } = {}
): Promise<MaintenanceReport> {
  const started = Date.now();
  const holder = crypto.randomUUID();
  const base: MaintenanceReport = {
    startedAt: new Date(started).toISOString(),
    durationMs: 0,
    providers: [],
    migrationsEnqueued: 0,
    migrationsProcessed: { completed: 0, retried: 0, failed: 0, cancelled: 0 },
    orphansPurged: 0,
    cleaned: {},
    systemWarnings: [],
  };
  if (!(await acquireLock(LOCK_NAME, holder, 600))) {
    return { ...base, skipped: "locked" };
  }
  const deadline = opts.deadlineMs ?? started + 45_000;
  const now = opts.now ?? new Date();
  try {
    await ensureProviders();
    const settings = await getSettings();

    // 1-3. health, usage, status per provider (independent: one failing provider never blocks others)
    for (const row of await listProviders()) {
      const entry: MaintenanceReport["providers"][number] = { key: row.providerKey };
      try {
        const lastDeep = typeof (row.usageDetails as Record<string, unknown>)?.lastDeepCheck === "number" ? ((row.usageDetails as Record<string, number>).lastDeepCheck) : 0;
        // DBByte's deep check consumes a metered request; do it at most every 6 hours.
        const deep = row.providerKey !== "dbbyte" || Date.now() - lastDeep > 6 * 3600_000;
        const h = await runHealthCheck(row, { deep });
        entry.health = h.ok ? "ok" : h.configured ? "failing" : "not_configured";
        if (deep && row.providerKey === "dbbyte" && h.ok) {
          await db
            .update(storageProviders)
            .set({ usageDetails: sql`${storageProviders.usageDetails} || ${JSON.stringify({ lastDeepCheck: Date.now() })}::jsonb` })
            .where(eq(storageProviders.id, row.id));
        }
        const fresh = (await listProviders()).find((p) => p.id === row.id)!;
        const s = await syncProviderUsage(fresh, now);
        entry.usageNote = s.note;
        const ev = await applyStatusEvaluation(row.id, settings, now);
        entry.status = ev.status;
      } catch (err) {
        entry.health = `error: ${err instanceof Error ? err.message : "unknown"}`;
      }
      base.providers.push(entry);
    }

    // 4. migration scheduling
    if (!settings.migrationsPaused) {
      for (const row of await listProviders()) {
        if (row.status === "EXHAUSTED" || row.status === "DRAINING") {
          const r = await enqueueMigrations(row.id, { reason: row.status.toLowerCase() });
          base.migrationsEnqueued += r.enqueued;
        } else if (row.status === "NEAR_LIMIT") {
          const p = usagePercents(row);
          let bytesTarget: number | undefined;
          if (p.storage !== null && p.storage >= settings.warnPercent && row.storageQuota) {
            bytesTarget = Math.max(0, row.storageUsed - (settings.warnPercent / 100) * row.storageQuota);
          }
          const r = await enqueueMigrations(row.id, { reason: "near_limit", limit: Math.ceil(settings.migrationBatchSize / 2), bytesTarget });
          base.migrationsEnqueued += r.enqueued;
        }
      }
    }

    // 5. retries / processing
    await requeueStaleJobs();
    const outcomes = await processDueMigrations(settings.migrationJobsPerRun, opts.migrationDeps ?? {}, deadline);
    for (const o of outcomes) {
      if (o.status === "completed") base.migrationsProcessed.completed++;
      else if (o.status === "retry") base.migrationsProcessed.retried++;
      else if (o.status === "failed") base.migrationsProcessed.failed++;
      else if (o.status === "cancelled") base.migrationsProcessed.cancelled++;
    }
    if (base.migrationsProcessed.completed > 0) {
      await raiseAlert({
        eventType: "migrations_completed",
        severity: "info",
        notify: true,
        message: `${base.migrationsProcessed.completed} thumbnail migration(s) completed successfully.`,
        dedupeKey: "migration:success",
        cooldownMinutes: 60,
      });
    }

    // 6. orphan cleanup
    await db
      .update(thumbnailAssets)
      .set({ status: "pending_delete", updatedAt: new Date() })
      .where(and(eq(thumbnailAssets.status, "active"), sql`${thumbnailAssets.fileId} is null`));
    base.orphansPurged = await purgeAssetsBatch(50, deadline);

    // 7. expired temporary data
    const rl = await db.execute(sql`DELETE FROM storage_rate_limits WHERE window_start < now() - interval '1 hour'`);
    const lk = await db.execute(sql`DELETE FROM storage_locks WHERE locked_until < now() - interval '1 day' AND name <> ${LOCK_NAME}`);
    const uh = await db.delete(providerUsageHistory).where(lt(providerUsageHistory.measuredAt, new Date(Date.now() - 90 * 86400_000))).returning({ id: providerUsageHistory.id });
    const ev = await db.delete(storageProviderEvents).where(lt(storageProviderEvents.createdAt, new Date(Date.now() - 180 * 86400_000))).returning({ id: storageProviderEvents.id });
    base.cleaned = { rateLimits: rl.rowCount ?? 0, locks: lk.rowCount ?? 0, usageHistory: uh.length, events: ev.length };

    // 8. system-level alerting
    const { candidates } = await loadCandidates();
    const probe = allocate(candidates, settings, { assetBytes: 200_000, seed: "health-probe" });
    if (!probe.order.length) {
      const msg = `No storage provider can currently accept thumbnail uploads. ${probe.excluded.map((e) => `${e.providerKey}: ${e.reasons.join("+")}`).join("; ")}`;
      base.systemWarnings.push(msg);
      await raiseAlert({ eventType: "system_no_eligible_provider", severity: "critical", message: msg, dedupeKey: "system:no_eligible_provider" });
    }
    return { ...base, durationMs: Date.now() - started };
  } finally {
    await releaseLock(LOCK_NAME, holder).catch(() => {});
  }
}
