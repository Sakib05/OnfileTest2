import crypto from "crypto";
import { and, asc, eq, inArray, lt, lte, notInArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { storageMigrationJobs, thumbnailAssets } from "@/db/schema";
import { allocate } from "./allocation";
import { getAdapter } from "./adapters";
import { logEvent, raiseAlert } from "./alerts";
import { providerFetch, sha256Hex, withRetry } from "./http";
import { getProviderById, handleProviderError, loadCandidates, recordUsageDelta } from "./providers";
import { getSettings } from "./settings";
import { PROVIDER_LABELS, type ObjectRef, type ProviderKey, type StorageAdapter } from "./types";

export type MigrationJob = typeof storageMigrationJobs.$inferSelect;

export class MigrationError extends Error {
  constructor(
    public readonly code: string,
    message?: string
  ) {
    super(message ?? code);
    this.name = "MigrationError";
  }
}

export interface MigrationDeps {
  sleep?: (ms: number) => Promise<void>;
  /** Confirms the NEW location actually delivers the image (default: real fetch). */
  verifyDelivery?: (adapter: StorageAdapter, ref: ObjectRef, expected: { checksum: string; size: number }) => Promise<void>;
  now?: () => Date;
}

export type MigrationOutcome =
  | { status: "completed"; destinationKey: ProviderKey }
  | { status: "retry" | "failed"; error: string }
  | { status: "cancelled"; reason: string }
  | { status: "skipped" };

function refOf(a: { providerObjectKey: string; deliveryMetadata: unknown }): ObjectRef {
  return { objectKey: a.providerObjectKey, deliveryMetadata: (a.deliveryMetadata ?? {}) as Record<string, unknown> };
}

/** Real post-migration delivery check: fetch via the same path clients will use. */
export async function defaultVerifyDelivery(adapter: StorageAdapter, ref: ObjectRef, expected: { checksum: string; size: number }): Promise<void> {
  const delivery = await adapter.getDeliveryUrl(ref, { expiresInSeconds: 60 });
  let bytes: Buffer;
  if (delivery.supported && delivery.value.clientSafe) {
    const res = await providerFetch(delivery.value.url, { method: "GET" });
    bytes = Buffer.from(await res.arrayBuffer());
    // Providers may legitimately optimise delivered bytes (e.g. ImageKit) — only require a non-empty image here;
    // exact bytes were already verified with verifyObject() against the stored object.
    if (bytes.length === 0) throw new MigrationError("delivery_empty", "New location returned an empty body");
    return;
  }
  bytes = (await adapter.downloadForMigration(ref)).buffer;
  if (bytes.length !== expected.size || sha256Hex(bytes) !== expected.checksum) {
    throw new MigrationError("delivery_mismatch", "New location delivered different bytes");
  }
}

/**
 * Queues migration jobs for assets on `sourceProviderId`. At most one open job
 * per asset (DB-enforced). Never queues when no eligible destination with
 * enough capacity exists.
 */
export async function enqueueMigrations(
  sourceProviderId: number,
  opts: { reason: string; limit?: number; bytesTarget?: number }
): Promise<{ enqueued: number; blockedReason?: string }> {
  const settings = await getSettings();
  const limit = Math.min(opts.limit ?? settings.migrationBatchSize, 500);
  const source = await getProviderById(sourceProviderId);
  if (!source) return { enqueued: 0, blockedReason: "source_not_found" };

  const { candidates } = await loadCandidates();
  const probe = allocate(candidates, settings, { assetBytes: 1, seed: `enqueue:${sourceProviderId}`, exclude: [source.providerKey as ProviderKey] });
  if (!probe.order.length) {
    await raiseAlert({
      providerId: sourceProviderId,
      eventType: "migration_blocked",
      severity: "error",
      message: `${PROVIDER_LABELS[source.providerKey as ProviderKey]}: migration needed but no eligible destination provider has capacity.`,
      dedupeKey: `provider:${source.providerKey}:migration_blocked`,
    });
    return { enqueued: 0, blockedReason: "no_destination_capacity" };
  }
  const destRoom = candidates
    .filter((c) => probe.order.includes(c.providerKey))
    .reduce((sum, c) => sum + Math.max(0, (c.storageQuota ?? 0) * (1 - settings.safetyMarginPercent / 100) - c.storageUsed), 0);

  const open = db
    .select({ id: storageMigrationJobs.assetId })
    .from(storageMigrationJobs)
    .where(inArray(storageMigrationJobs.status, ["pending", "running", "paused"]));
  const assets = await db
    .select({ id: thumbnailAssets.id, size: thumbnailAssets.fileSize })
    .from(thumbnailAssets)
    .where(and(eq(thumbnailAssets.providerId, sourceProviderId), eq(thumbnailAssets.status, "active"), notInArray(thumbnailAssets.id, open)))
    .orderBy(asc(thumbnailAssets.id))
    .limit(limit);

  let total = 0;
  let moved = 0;
  const picked: { id: number }[] = [];
  for (const a of assets) {
    if (opts.bytesTarget !== undefined && moved >= opts.bytesTarget) break;
    if (total + a.size > destRoom) break; // destination capacity guard
    total += a.size;
    moved += a.size;
    picked.push({ id: a.id });
  }
  if (!picked.length) return { enqueued: 0, blockedReason: assets.length ? "insufficient_destination_capacity" : undefined };

  const inserted = await db
    .insert(storageMigrationJobs)
    .values(picked.map((a) => ({ assetId: a.id, sourceProviderId, reason: opts.reason.slice(0, 64) })))
    .onConflictDoNothing()
    .returning({ id: storageMigrationJobs.id });
  return { enqueued: inserted.length };
}

async function finishFailure(job: MigrationJob, err: unknown, now: Date): Promise<MigrationOutcome> {
  const settings = await getSettings();
  const message = (err instanceof Error ? err.message : "unknown error").slice(0, 500);
  const retryCount = job.retryCount + 1;
  const exhausted = retryCount >= settings.migrationMaxRetries;
  const backoffMs = Math.min(6 * 3600_000, 5 * 60_000 * 2 ** (retryCount - 1));
  await db
    .update(storageMigrationJobs)
    .set({
      status: exhausted ? "failed" : "pending",
      retryCount,
      errorDetails: message,
      nextAttemptAt: new Date(now.getTime() + backoffMs),
      updatedAt: now,
    })
    .where(eq(storageMigrationJobs.id, job.id));
  await logEvent({
    providerId: job.sourceProviderId,
    eventType: exhausted ? "migration_failed" : "migration_retry",
    severity: exhausted ? "error" : "warning",
    message: `Migration job ${job.id} ${exhausted ? "failed permanently" : `will retry (${retryCount}/${settings.migrationMaxRetries})`}: ${message}`,
    details: { jobId: job.id, assetId: job.assetId },
  });
  if (exhausted) {
    await raiseAlert({
      providerId: job.sourceProviderId,
      eventType: "migration_failed_alert",
      severity: "error",
      message: `Migration job ${job.id} failed after ${retryCount} attempts: ${message}. The old object was kept.`,
      dedupeKey: `migration:${job.sourceProviderId}:failed`,
    });
  }
  return { status: exhausted ? "failed" : "retry", error: message };
}

/**
 * Runs one migration job. Order of operations (old object is deleted LAST):
 *   claim → download source → checksum vs DB → upload to eligible destination →
 *   verify → compare-and-swap DB pointer → verify delivery → delete old object.
 * Any failure before the swap leaves the old reference untouched; a failed
 * delivery check rolls the pointer back.
 */
export async function runMigrationJob(jobId: number, deps: MigrationDeps = {}): Promise<MigrationOutcome> {
  const now = deps.now?.() ?? new Date();
  // Compare against the DATABASE clock (not the app server's) so clock skew can never starve or double-run jobs.
  const due = deps.now ? lte(storageMigrationJobs.nextAttemptAt, now) : sql`${storageMigrationJobs.nextAttemptAt} <= now()`;
  const [job] = await db
    .update(storageMigrationJobs)
    .set({ status: "running", startedAt: now, updatedAt: now })
    .where(and(eq(storageMigrationJobs.id, jobId), eq(storageMigrationJobs.status, "pending"), due))
    .returning();
  if (!job) return { status: "skipped" };

  const cancel = async (reason: string): Promise<MigrationOutcome> => {
    await db
      .update(storageMigrationJobs)
      .set({ status: "cancelled", errorDetails: reason, completedAt: new Date(), updatedAt: new Date() })
      .where(eq(storageMigrationJobs.id, job.id));
    return { status: "cancelled", reason };
  };

  let destUploaded: { row: NonNullable<Awaited<ReturnType<typeof getProviderById>>>; ref: ObjectRef } | null = null;
  try {
    const settings = await getSettings();
    const [asset] = await db.select().from(thumbnailAssets).where(eq(thumbnailAssets.id, job.assetId)).limit(1);
    if (!asset || asset.status !== "active" || asset.providerId !== job.sourceProviderId) return await cancel("asset_changed_or_removed");

    const source = await getProviderById(job.sourceProviderId);
    if (!source) throw new MigrationError("source_provider_missing");
    const sourceKey = source.providerKey as ProviderKey;
    const sourceAdapter = getAdapter(sourceKey);
    const oldRef = refOf(asset);

    const { candidates, rows } = await loadCandidates();
    const alloc = allocate(candidates, settings, {
      assetBytes: asset.fileSize,
      seed: `migrate:${job.id}:${job.retryCount}`,
      exclude: [sourceKey],
    });
    if (!alloc.order.length) throw new MigrationError("no_destination", `No eligible destination: ${alloc.summary}`);

    // 1. Download the stored original and make sure it is still what we recorded.
    const downloaded = await withRetry(() => sourceAdapter.downloadForMigration(oldRef), {
      maxAttempts: settings.maxRetriesPerProvider,
      maxRetryAfterMs: settings.maxRetryAfterMs,
      sleep: deps.sleep,
    });
    const checksum = sha256Hex(downloaded.buffer);
    if (checksum !== asset.checksum) throw new MigrationError("source_checksum_mismatch", "Stored object no longer matches its recorded checksum");

    // 2-4. Upload to the first destination that accepts and verifies it.
    let lastErr: unknown = null;
    let uploadedRef: ObjectRef | null = null;
    let destRow: NonNullable<Awaited<ReturnType<typeof getProviderById>>> | null = null;
    for (const destKey of alloc.order.slice(0, 2)) {
      const row = rows.find((r) => r.providerKey === destKey)!;
      const adapter = getAdapter(destKey);
      const ext = asset.mimeType === "image/png" ? "png" : asset.mimeType === "image/jpeg" ? "jpg" : "webp";
      try {
        const up = await withRetry(
          () =>
            adapter.upload({
              buffer: downloaded.buffer,
              mimeType: asset.mimeType,
              objectName: `m${asset.id}-${crypto.randomUUID()}.${ext}`,
              checksum,
            }),
          { maxAttempts: settings.maxRetriesPerProvider, maxRetryAfterMs: settings.maxRetryAfterMs, sleep: deps.sleep }
        );
        const ref: ObjectRef = { objectKey: up.objectKey, deliveryMetadata: up.deliveryMetadata };
        destUploaded = { row, ref };
        const v = await adapter.verifyObject(ref, { checksum, size: asset.fileSize });
        if (!v.ok) throw new MigrationError("destination_verification_failed", v.reason);
        uploadedRef = ref;
        destRow = row;
        break;
      } catch (err) {
        lastErr = err;
        if (destUploaded) {
          await adapter.delete(destUploaded.ref).catch(() => {});
          destUploaded = null;
        }
        if (!(err instanceof MigrationError)) await handleProviderError(row, err, "migration");
      }
    }
    if (!uploadedRef || !destRow) throw lastErr ?? new MigrationError("upload_failed");
    destUploaded = { row: destRow, ref: uploadedRef };
    const destAdapter = getAdapter(destRow.providerKey as ProviderKey);

    // 5. Compare-and-swap the database pointer.
    const [swapped] = await db
      .update(thumbnailAssets)
      .set({
        providerId: destRow.id,
        providerObjectKey: uploadedRef.objectKey,
        deliveryMetadata: uploadedRef.deliveryMetadata,
        version: sql`${thumbnailAssets.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(thumbnailAssets.id, asset.id),
          eq(thumbnailAssets.status, "active"),
          eq(thumbnailAssets.providerId, source.id),
          eq(thumbnailAssets.providerObjectKey, asset.providerObjectKey),
          eq(thumbnailAssets.version, asset.version)
        )
      )
      .returning();
    if (!swapped) {
      await destAdapter.delete(uploadedRef).catch(() => {});
      destUploaded = null;
      return await cancel("asset_modified_during_migration");
    }
    await db.update(storageMigrationJobs).set({ destinationProviderId: destRow.id }).where(eq(storageMigrationJobs.id, job.id));

    // 6. Verify the new delivery path; roll back the pointer on failure.
    try {
      await (deps.verifyDelivery ?? defaultVerifyDelivery)(destAdapter, uploadedRef, { checksum, size: asset.fileSize });
    } catch (err) {
      await db
        .update(thumbnailAssets)
        .set({
          providerId: source.id,
          providerObjectKey: asset.providerObjectKey,
          deliveryMetadata: asset.deliveryMetadata,
          version: sql`${thumbnailAssets.version} + 1`,
          updatedAt: new Date(),
        })
        .where(and(eq(thumbnailAssets.id, asset.id), eq(thumbnailAssets.providerId, destRow.id), eq(thumbnailAssets.providerObjectKey, uploadedRef.objectKey)));
      await destAdapter.delete(uploadedRef).catch(() => {});
      destUploaded = null;
      throw err instanceof MigrationError ? err : new MigrationError("delivery_verification_failed", err instanceof Error ? err.message : undefined);
    }
    destUploaded = null; // pointer swapped & verified: destination object is now the primary

    // 7. Delete the old object LAST. If that fails, keep a tombstone for the orphan sweeper.
    let oldDeleted = true;
    try {
      await sourceAdapter.delete(oldRef);
      await recordUsageDelta(source.id, { storage: -asset.fileSize, requests: 1 });
    } catch (err) {
      oldDeleted = false;
      await db
        .insert(thumbnailAssets)
        .values({
          fileId: asset.fileId,
          ownerId: asset.ownerId,
          providerId: source.id,
          providerObjectKey: asset.providerObjectKey,
          deliveryMetadata: asset.deliveryMetadata,
          mimeType: asset.mimeType,
          fileSize: asset.fileSize,
          width: asset.width,
          height: asset.height,
          checksum: asset.checksum,
          status: "pending_delete",
        })
        .onConflictDoNothing();
      await logEvent({
        providerId: source.id,
        eventType: "old_object_delete_failed",
        severity: "warning",
        message: `Migration job ${job.id}: migrated, but the old object could not be deleted yet (${err instanceof Error ? err.message : "error"}). Queued for cleanup.`,
        details: { assetId: asset.id },
      });
    }
    await recordUsageDelta(destRow.id, { storage: asset.fileSize, bandwidth: asset.fileSize * 2, requests: 3 });

    await db
      .update(storageMigrationJobs)
      .set({ status: "completed", destinationProviderId: destRow.id, errorDetails: oldDeleted ? null : "old_object_cleanup_pending", completedAt: new Date(), updatedAt: new Date() })
      .where(eq(storageMigrationJobs.id, job.id));
    await logEvent({
      providerId: destRow.id,
      eventType: "migration_completed",
      severity: "info",
      message: `Thumbnail asset ${asset.id} migrated ${PROVIDER_LABELS[sourceKey]} → ${PROVIDER_LABELS[destRow.providerKey as ProviderKey]}.`,
      details: { jobId: job.id, assetId: asset.id },
    });
    return { status: "completed", destinationKey: destRow.providerKey as ProviderKey };
  } catch (err) {
    if (destUploaded) {
      // Pointer was never swapped (or already rolled back): remove the stray copy.
      await getAdapter(destUploaded.row.providerKey as ProviderKey).delete(destUploaded.ref).catch(() => {});
    }
    return finishFailure(job, err, now);
  }
}

/** Processes due jobs sequentially (respecting the global pause switch). */
export async function processDueMigrations(maxJobs: number, deps: MigrationDeps = {}, deadlineMs?: number): Promise<MigrationOutcome[]> {
  const settings = await getSettings();
  if (settings.migrationsPaused) return [];
  const now = deps.now?.() ?? new Date();
  const due = await db
    .select({ id: storageMigrationJobs.id })
    .from(storageMigrationJobs)
    .where(and(eq(storageMigrationJobs.status, "pending"), deps.now ? lte(storageMigrationJobs.nextAttemptAt, now) : sql`${storageMigrationJobs.nextAttemptAt} <= now()`))
    .orderBy(asc(storageMigrationJobs.nextAttemptAt))
    .limit(maxJobs);
  const results: MigrationOutcome[] = [];
  for (const j of due) {
    if (deadlineMs !== undefined && Date.now() > deadlineMs) break;
    results.push(await runMigrationJob(j.id, deps));
  }
  return results;
}

/** Jobs stuck in "running" (crashed/timed-out invocation) go back to pending. */
export async function requeueStaleJobs(staleMinutes = 10): Promise<number> {
  const cutoff = new Date(Date.now() - staleMinutes * 60_000);
  const rows = await db
    .update(storageMigrationJobs)
    .set({ status: "pending", retryCount: sql`${storageMigrationJobs.retryCount} + 1`, errorDetails: "stale_running_job_requeued", updatedAt: new Date() })
    .where(and(eq(storageMigrationJobs.status, "running"), lt(storageMigrationJobs.updatedAt, cutoff)))
    .returning({ id: storageMigrationJobs.id });
  return rows.length;
}

export async function pauseJob(jobId: number): Promise<boolean> {
  const rows = await db
    .update(storageMigrationJobs)
    .set({ status: "paused", updatedAt: new Date() })
    .where(and(eq(storageMigrationJobs.id, jobId), eq(storageMigrationJobs.status, "pending")))
    .returning({ id: storageMigrationJobs.id });
  return rows.length > 0;
}

export async function resumeJob(jobId: number): Promise<boolean> {
  const rows = await db
    .update(storageMigrationJobs)
    .set({ status: "pending", nextAttemptAt: new Date(), updatedAt: new Date() })
    .where(and(eq(storageMigrationJobs.id, jobId), eq(storageMigrationJobs.status, "paused")))
    .returning({ id: storageMigrationJobs.id });
  return rows.length > 0;
}

/** Re-queues a permanently failed job (admin action). Blocked if the asset already has another open job. */
export async function retryFailedJob(jobId: number): Promise<boolean> {
  try {
    const rows = await db
      .update(storageMigrationJobs)
      .set({ status: "pending", retryCount: 0, nextAttemptAt: new Date(), errorDetails: null, updatedAt: new Date() })
      .where(and(eq(storageMigrationJobs.id, jobId), eq(storageMigrationJobs.status, "failed")))
      .returning({ id: storageMigrationJobs.id });
    return rows.length > 0;
  } catch {
    return false; // unique open-job index: another open job exists for this asset
  }
}
