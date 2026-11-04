import { desc, eq, sql } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db";
import {
  providerUsageHistory,
  storageAuditLogs,
  storageMigrationJobs,
  storageProviderEvents,
  storageProviders,
  type User,
} from "@/db/schema";
import { getSessionUser, isSameOriginRequest } from "@/lib/auth";
import { allocate } from "./allocation";
import { getAdapter } from "./adapters";
import { getAdminTelegramIds } from "./alerts";
import { enqueueMigrations, pauseJob, resumeJob, retryFailedJob } from "./migration";
import { runHealthCheck, runMaintenance, syncProviderUsage } from "./maintenance";
import {
  applyStatusEvaluation,
  ensureProviders,
  getAssetStats,
  getProviderByKey,
  listProviders,
  loadCandidates,
  readMetricSources,
} from "./providers";
import { getSettings, SettingsValidationError, updateSettings } from "./settings";
import { usagePercents } from "./status";
import { isProviderKey, PROVIDER_LABELS, type ProviderKey } from "./types";

// ─── Authorisation ─────────────────────────────────────────────────────────

/** Admins are configured server-side (ADMIN_TELEGRAM_IDS). Empty list => nobody is admin. */
export function isAdminUser(user: Pick<User, "telegramId"> | null, env: Record<string, string | undefined> = process.env): boolean {
  if (!user?.telegramId) return false;
  return getAdminTelegramIds(env).includes(user.telegramId);
}

/**
 * Server-side admin gate. Identity comes ONLY from the session cookie that was
 * created after Telegram initData signature validation — never from a
 * client-supplied Telegram id.
 */
export async function requireAdmin(req: NextRequest, opts: { mutating?: boolean } = {}): Promise<{ user: User } | { response: NextResponse }> {
  if (opts.mutating && !isSameOriginRequest(req)) {
    return { response: NextResponse.json({ error: "Invalid request origin" }, { status: 403 }) };
  }
  const user = await getSessionUser(req);
  if (!user) return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!isAdminUser(user)) return { response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { user };
}

// ─── Snapshot for the dashboard ────────────────────────────────────────────

export async function buildSnapshot() {
  await ensureProviders();
  const [providers, stats, settings, { candidates }] = await Promise.all([listProviders(), getAssetStats(), getSettings(), loadCandidates()]);

  const recentEvents = await db.select().from(storageProviderEvents).orderBy(desc(storageProviderEvents.createdAt)).limit(60);
  const audit = await db.select().from(storageAuditLogs).orderBy(desc(storageAuditLogs.createdAt)).limit(50);
  const jobCounts = await db
    .select({ status: storageMigrationJobs.status, count: sql<number>`count(*)::int` })
    .from(storageMigrationJobs)
    .groupBy(storageMigrationJobs.status);
  const jobs = await db.select().from(storageMigrationJobs).orderBy(desc(storageMigrationJobs.updatedAt)).limit(40);

  const totalAssets = [...stats.values()].reduce((s, v) => s + v.count, 0);
  const probe = allocate(candidates, settings, { assetBytes: 200_000, seed: "dashboard-preview" });

  const warnings: string[] = [];
  const providerViews = providers.map((p) => {
    const key = p.providerKey as ProviderKey;
    const adapter = getAdapter(key);
    const pct = usagePercents(p);
    const recentErrors = recentEvents
      .filter((e) => e.providerId === p.id && (e.severity === "error" || e.severity === "critical" || e.severity === "warning"))
      .slice(0, 5)
      .map((e) => ({ at: e.createdAt, type: e.eventType, severity: e.severity, message: e.message }));
    if (p.status === "NEAR_LIMIT") warnings.push(`${PROVIDER_LABELS[key]} is near its limit (${Math.round(pct.max ?? 0)}%).`);
    if (p.status === "EXHAUSTED") warnings.push(`${PROVIDER_LABELS[key]} is exhausted — new uploads stopped.`);
    if (p.status === "ERROR") warnings.push(`${PROVIDER_LABELS[key]} has an error: ${p.errorDetails ?? "see events"}.`);
    if (p.commercialTermsStatus === "PROHIBITED") warnings.push(`${PROVIDER_LABELS[key]}: commercial terms marked PROHIBITED (no uploads).`);
    if (p.storageQuota === null || p.bandwidthQuota === null) warnings.push(`${PROVIDER_LABELS[key]}: quota unknown — set quotas before it can receive uploads.`);
    if (p.enabled && !p.billingCycleDay) warnings.push(`${PROVIDER_LABELS[key]}: billing cycle day unknown — monthly counters are not auto-reset.`);
    const d = (p.usageDetails ?? {}) as Record<string, unknown>;
    return {
      id: p.id,
      key,
      label: PROVIDER_LABELS[key],
      configured: adapter.isConfigured(), // boolean only — never any credential material
      enabled: p.enabled,
      status: p.status,
      commercialTermsStatus: p.commercialTermsStatus,
      commercialTermsNote: p.commercialTermsNote,
      storage: { quota: p.storageQuota, used: p.storageUsed, percent: pct.storage, source: readMetricSources(p).storage },
      bandwidth: { quota: p.bandwidthQuota, used: p.bandwidthUsed, percent: pct.bandwidth, source: readMetricSources(p).bandwidth, breakdown: d.bandwidthBreakdown ?? null },
      requests: { quota: p.requestQuota, used: p.requestUsed, percent: pct.requests, source: readMetricSources(p).requests },
      usageSource: p.usageSource,
      usageNotes: { unsupported: d.usageUnsupportedReason ?? null, lastError: d.lastUsageError ?? null, official: d.officialExtra ?? null, quotaSource: d.quotaSource ?? null, quotaOrigin: d.quotaOrigin ?? null },
      weight: Number(p.weight),
      maxAssets: p.maxAssets,
      billingCycleDay: p.billingCycleDay,
      billingPeriodStart: p.billingPeriodStart,
      health: { ok: p.healthOk, lastCheck: p.lastHealthCheck },
      lastUsageSync: p.lastUsageSync,
      errorDetails: p.errorDetails,
      consecutiveUploadFailures: p.consecutiveUploadFailures,
      consecutiveDeliveryFailures: p.consecutiveDeliveryFailures,
      assetCount: stats.get(p.id)?.count ?? 0,
      assetBytes: stats.get(p.id)?.bytes ?? 0,
      recentErrors,
    };
  });

  const failedJobs = jobs.filter((j) => j.status === "failed");
  if (failedJobs.length) warnings.push(`${failedJobs.length} migration job(s) failed.`);
  const problems = providerViews.filter((p) => p.enabled && (p.status === "ERROR" || p.status === "EXHAUSTED"));
  const systemHealth = !probe.order.length ? "CRITICAL" : problems.length || failedJobs.length ? "DEGRADED" : "HEALTHY";

  const usageHistory = await db.select().from(providerUsageHistory).orderBy(desc(providerUsageHistory.measuredAt)).limit(40);

  return {
    generatedAt: new Date().toISOString(),
    systemHealth,
    warnings,
    providers: providerViews,
    allocation: {
      totalAssets,
      distribution: providerViews.map((p) => ({ key: p.key, label: p.label, count: p.assetCount, bytes: p.assetBytes, percent: totalAssets ? (p.assetCount / totalAssets) * 100 : 0 })),
      nextUploadPreview: { ranked: probe.ranked, excluded: probe.excluded },
    },
    migrations: { paused: settings.migrationsPaused, counts: Object.fromEntries(jobCounts.map((c) => [c.status, c.count])), jobs },
    events: recentEvents,
    audit,
    usageHistory,
    settings,
    adminsConfigured: getAdminTelegramIds().length,
  };
}

// ─── Actions (every one is audited) ────────────────────────────────────────

type Actor = { id: number; telegramId: string | null };
export type ActionResult = { ok: true; result?: unknown } | { ok: false; error: string; status: number };

const fail = (error: string, status = 400): ActionResult => ({ ok: false, error, status });

function nonNegInt(v: unknown): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= Number.MAX_SAFE_INTEGER) return Math.floor(v);
  throw new SettingsValidationError("Quota/usage values must be non-negative numbers (or null to clear)");
}

export async function writeAudit(actor: Actor, action: string, targetType: string | null, targetId: string | null, details: Record<string, unknown>) {
  await db.insert(storageAuditLogs).values({ actorUserId: actor.id, actorTelegramId: actor.telegramId, action, targetType, targetId, details });
}

export async function runAdminAction(actor: Actor, body: unknown): Promise<ActionResult> {
  if (!body || typeof body !== "object") return fail("Invalid body");
  const b = body as Record<string, unknown>;
  const action = typeof b.action === "string" ? b.action : "";
  try {
    await ensureProviders();

    // Actions that do not target a provider.
    switch (action) {
      case "setSettings": {
        if (!b.settings || typeof b.settings !== "object") return fail("settings required");
        const next = await updateSettings(b.settings as Record<string, unknown>);
        await writeAudit(actor, action, "settings", null, { patch: b.settings as Record<string, unknown> });
        return { ok: true, result: next };
      }
      case "pauseMigrations":
      case "resumeMigrations": {
        const next = await updateSettings({ migrationsPaused: action === "pauseMigrations" });
        await writeAudit(actor, action, "migrations", null, {});
        return { ok: true, result: { migrationsPaused: next.migrationsPaused } };
      }
      case "pauseJob":
      case "resumeJob":
      case "retryJob": {
        const jobId = Number(b.jobId);
        if (!Number.isInteger(jobId) || jobId < 1) return fail("jobId required");
        const done = action === "pauseJob" ? await pauseJob(jobId) : action === "resumeJob" ? await resumeJob(jobId) : await retryFailedJob(jobId);
        await writeAudit(actor, action, "migration_job", String(jobId), { done });
        return done ? { ok: true } : fail("Job is not in a state that allows this action", 409);
      }
      case "runMaintenance": {
        const report = await runMaintenance();
        await writeAudit(actor, action, "maintenance", null, { skipped: report.skipped ?? null });
        return { ok: true, result: report };
      }
    }

    // Provider-targeted actions.
    if (!isProviderKey(b.providerKey)) return fail("Unknown providerKey");
    const key: ProviderKey = b.providerKey;
    const row = await getProviderByKey(key);
    if (!row) return fail("Provider not found", 404);
    const audit = (details: Record<string, unknown>) => writeAudit(actor, action, "provider", key, details);

    switch (action) {
      case "setEnabled": {
        if (typeof b.enabled !== "boolean") return fail("enabled must be boolean");
        await db
          .update(storageProviders)
          .set({ enabled: b.enabled, status: b.enabled ? "ACTIVE" : "DISABLED", updatedAt: new Date() })
          .where(eq(storageProviders.id, row.id));
        if (b.enabled) await applyStatusEvaluation(row.id);
        await audit({ enabled: b.enabled });
        return { ok: true };
      }
      case "setDraining": {
        if (typeof b.draining !== "boolean") return fail("draining must be boolean");
        await db
          .update(storageProviders)
          .set({ status: b.draining ? "DRAINING" : "ACTIVE", updatedAt: new Date() })
          .where(eq(storageProviders.id, row.id));
        if (!b.draining) await applyStatusEvaluation(row.id);
        await audit({ draining: b.draining });
        return { ok: true };
      }
      case "clearError": {
        await db.update(storageProviders).set({ status: row.status === "ERROR" ? "ACTIVE" : row.status, errorDetails: null, quotaErrorAt: null, consecutiveUploadFailures: 0, consecutiveDeliveryFailures: 0, updatedAt: new Date() }).where(eq(storageProviders.id, row.id));
        await applyStatusEvaluation(row.id);
        await audit({});
        return { ok: true };
      }
      case "health": {
        const res = await runHealthCheck(row, { deep: true });
        await audit({ ok: res.ok });
        return { ok: true, result: res };
      }
      case "syncUsage": {
        const res = await syncProviderUsage(row);
        await applyStatusEvaluation(row.id);
        await audit({ note: res.note ?? null });
        return { ok: true, result: res };
      }
      case "setQuotas": {
        const set: Partial<typeof storageProviders.$inferInsert> = { updatedAt: new Date() };
        const details = { ...(row.usageDetails ?? {}) } as Record<string, unknown>;
        const manual = { ...((details.manual ?? {}) as Record<string, boolean>) };
        const sq = nonNegInt(b.storageQuota);
        const bq = nonNegInt(b.bandwidthQuota);
        const rq = nonNegInt(b.requestQuota);
        if (sq !== undefined) set.storageQuota = sq;
        if (bq !== undefined) set.bandwidthQuota = bq;
        if (rq !== undefined) set.requestQuota = rq;
        const su = nonNegInt(b.storageUsed);
        const bu = nonNegInt(b.bandwidthUsed);
        const ru = nonNegInt(b.requestUsed);
        if (typeof su === "number") { set.storageUsed = su; manual.storage = true; }
        if (typeof bu === "number") { set.bandwidthUsed = bu; manual.bandwidth = true; }
        if (typeof ru === "number") { set.requestUsed = ru; manual.requests = true; }
        if (b.clearManual === true) { delete manual.storage; delete manual.bandwidth; delete manual.requests; }
        if (b.billingCycleDay !== undefined) {
          if (b.billingCycleDay !== null && !(Number.isInteger(b.billingCycleDay) && (b.billingCycleDay as number) >= 1 && (b.billingCycleDay as number) <= 28)) return fail("billingCycleDay must be 1-28 or null");
          set.billingCycleDay = b.billingCycleDay as number | null;
        }
        details.manual = manual;
        details.quotaSource = "MANUAL";
        set.usageDetails = details;
        await db.update(storageProviders).set(set).where(eq(storageProviders.id, row.id));
        await applyStatusEvaluation(row.id);
        await audit({ storageQuota: sq ?? undefined, bandwidthQuota: bq ?? undefined, requestQuota: rq ?? undefined, usageEdited: { storage: typeof su === "number", bandwidth: typeof bu === "number", requests: typeof ru === "number" }, billingCycleDay: b.billingCycleDay as number | null | undefined });
        return { ok: true };
      }
      case "setWeight": {
        const w = Number(b.weight);
        if (!Number.isFinite(w) || w < 0 || w > 100) return fail("weight must be between 0 and 100");
        const ma = nonNegInt(b.maxAssets);
        await db.update(storageProviders).set({ weight: String(w), ...(ma !== undefined ? { maxAssets: ma } : {}), updatedAt: new Date() }).where(eq(storageProviders.id, row.id));
        await audit({ weight: w, maxAssets: ma });
        return { ok: true };
      }
      case "setTerms": {
        const status = b.status;
        if (status !== "UNREVIEWED" && status !== "PERMITTED" && status !== "AMBIGUOUS" && status !== "PROHIBITED") return fail("Invalid terms status");
        const note = typeof b.note === "string" ? b.note.slice(0, 1000) : row.commercialTermsNote;
        await db.update(storageProviders).set({ commercialTermsStatus: status, commercialTermsNote: note, updatedAt: new Date() }).where(eq(storageProviders.id, row.id));
        await audit({ status });
        return { ok: true };
      }
      case "startMigration": {
        const limit = b.limit === undefined ? undefined : Number(b.limit);
        if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 500)) return fail("limit must be 1-500");
        const res = await enqueueMigrations(row.id, { reason: "admin", limit });
        await audit({ limit: limit ?? null, ...res });
        return { ok: true, result: res };
      }
    }
    return fail(`Unknown action: ${action}`);
  } catch (err) {
    if (err instanceof SettingsValidationError) return fail(err.message);
    console.error("storage_admin_action_failed", action, err instanceof Error ? err.message : "unknown");
    return fail("Internal server error", 500);
  }
}
