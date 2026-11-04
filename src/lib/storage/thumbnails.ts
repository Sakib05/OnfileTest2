import crypto from "crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { files, storageProviders, thumbnailAssets } from "@/db/schema";
import { allocate } from "./allocation";
import { getAdapter } from "./adapters";
import { logEvent } from "./alerts";
import { withRetry } from "./http";
import { ImageValidationError, processThumbnail } from "./imageProcessing";
import {
  ensureProviders,
  getProviderById,
  handleProviderError,
  loadCandidates,
  markProviderSuccess,
  recordDelivery,
  recordUsageDelta,
  type ProviderRow,
} from "./providers";
import { getSettings } from "./settings";
import { PROVIDER_LABELS, ProviderError, type ObjectRef, type ProviderKey } from "./types";

export type ThumbnailAsset = typeof thumbnailAssets.$inferSelect;

export class ThumbnailError extends Error {
  constructor(
    public readonly code: "not_found" | "no_provider_available" | "upload_failed" | "storage_unavailable",
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "ThumbnailError";
  }
}

export { ImageValidationError };

export interface ThumbnailDeps {
  sleep?: (ms: number) => Promise<void>;
  /** Overrides the allocation seed (tests / replay). */
  seed?: string;
}

export interface UploadThumbnailResult {
  asset: Pick<ThumbnailAsset, "id" | "fileId" | "width" | "height" | "mimeType" | "fileSize" | "updatedAt">;
  providerKey: ProviderKey;
  allocation: string;
  strategy: string;
  replaced: boolean;
}

/**
 * Authorisation rule shared by both delivery routes: a thumbnail may be
 * delivered when the file is published, or the requester is the file's owner.
 */
export function canAccessThumbnail(file: { userId: number; isPublished: boolean | null }, viewerUserId: number | null): boolean {
  if (file.isPublished) return true;
  return viewerUserId !== null && file.userId === viewerUserId;
}

function refOf(asset: Pick<ThumbnailAsset, "providerObjectKey" | "deliveryMetadata">): ObjectRef {
  return { objectKey: asset.providerObjectKey, deliveryMetadata: (asset.deliveryMetadata ?? {}) as Record<string, unknown> };
}

async function bestEffortDelete(row: ProviderRow, ref: ObjectRef): Promise<boolean> {
  try {
    await getAdapter(row.providerKey as ProviderKey).delete(ref);
    return true;
  } catch {
    return false;
  }
}

/**
 * Process → allocate → upload (with retry/failover) → verify → commit.
 * A database asset record is created ONLY after upload AND verification succeed.
 * Exactly one provider stores the thumbnail.
 */
export async function uploadThumbnail(
  args: { fileId: number; ownerId: number; image: Buffer; declaredMime?: string | null },
  deps: ThumbnailDeps = {}
): Promise<UploadThumbnailResult> {
  const [file] = await db
    .select({ id: files.id })
    .from(files)
    .where(and(eq(files.id, args.fileId), eq(files.userId, args.ownerId)))
    .limit(1);
  if (!file) throw new ThumbnailError("not_found", "File not found", 404);

  const processed = await processThumbnail(args.image, { declaredMime: args.declaredMime ?? null });

  await ensureProviders();
  const settings = await getSettings();
  const { rows, candidates } = await loadCandidates();
  const seed = deps.seed ?? `${args.fileId}:${processed.checksum.slice(0, 12)}:${Date.now()}`;
  const allocation = allocate(candidates, settings, { assetBytes: processed.buffer.length, seed });
  if (!allocation.order.length) {
    await logEvent({
      eventType: "allocation_failed",
      severity: "error",
      message: `No eligible storage provider for thumbnail upload: ${allocation.summary}`,
      details: { excluded: allocation.excluded },
    });
    throw new ThumbnailError("no_provider_available", "Thumbnail storage is temporarily unavailable. Please try again later.", 503);
  }

  let lastError: unknown = null;
  let attempts = 0;
  for (const key of allocation.order) {
    if (attempts >= settings.maxUploadProviderAttempts) break;
    attempts++;
    const row = rows.find((r) => r.providerKey === key)!;
    const adapter = getAdapter(key);
    const objectName = `${args.fileId}-${crypto.randomUUID()}.${processed.extension}`;

    let uploaded;
    try {
      uploaded = await withRetry(
        () => adapter.upload({ buffer: processed.buffer, mimeType: processed.mimeType, objectName, checksum: processed.checksum }),
        { maxAttempts: settings.maxRetriesPerProvider, maxRetryAfterMs: settings.maxRetryAfterMs, sleep: deps.sleep }
      );
    } catch (err) {
      lastError = err;
      await handleProviderError(row, err, "upload");
      continue;
    }
    const ref: ObjectRef = { objectKey: uploaded.objectKey, deliveryMetadata: uploaded.deliveryMetadata };

    // Verify before any DB record exists.
    let verified;
    try {
      verified = await adapter.verifyObject(ref, { checksum: processed.checksum, size: processed.buffer.length });
    } catch (err) {
      verified = { ok: false, reason: err instanceof Error ? err.message : "verify_error" };
    }
    if (!verified.ok) {
      lastError = new ProviderError("unknown", `verification failed: ${verified.reason}`);
      await bestEffortDelete(row, ref);
      await handleProviderError(row, lastError, "upload");
      continue;
    }

    try {
      const committed = await commitAsset({
        fileId: args.fileId,
        ownerId: args.ownerId,
        providerId: row.id,
        ref,
        mimeType: processed.mimeType,
        fileSize: processed.buffer.length,
        width: processed.width,
        height: processed.height,
        checksum: processed.checksum,
        allocationReason: {
          summary: allocation.summary,
          seed: allocation.seed,
          ranked: allocation.ranked,
          excluded: allocation.excluded,
          strategy: processed.strategy,
          originalBytes: processed.originalBytes,
        },
      });
      await recordUsageDelta(row.id, { storage: processed.buffer.length, bandwidth: processed.buffer.length, requests: 2 });
      await markProviderSuccess(row.id, "upload");
      await logEvent({
        providerId: row.id,
        eventType: "thumbnail_uploaded",
        severity: "info",
        message: `Thumbnail for file ${args.fileId} stored on ${PROVIDER_LABELS[key]} — ${allocation.summary}`,
        details: { fileId: args.fileId, bytes: processed.buffer.length, strategy: processed.strategy },
      });
      if (committed.replaced) await purgeAsset(committed.replaced.id).catch(() => false);
      return {
        asset: committed.asset,
        providerKey: key,
        allocation: allocation.summary,
        strategy: processed.strategy,
        replaced: !!committed.replaced,
      };
    } catch (err) {
      // DB commit failed: do not leave an orphan behind.
      const deleted = await bestEffortDelete(row, ref);
      if (!deleted) {
        await logEvent({
          providerId: row.id,
          eventType: "orphan_possible",
          severity: "warning",
          message: `Upload committed remotely but DB commit and cleanup failed; object may be orphaned.`,
          details: { objectKey: ref.objectKey },
        });
      }
      if (err instanceof ThumbnailError) throw err;
      throw new ThumbnailError("upload_failed", "Could not save the thumbnail. Please try again.", 500);
    }
  }

  throw new ThumbnailError(
    "upload_failed",
    lastError instanceof ProviderError && lastError.kind === "quota"
      ? "Thumbnail storage is full right now. Please try again later."
      : "Could not upload the thumbnail. Please try again.",
    503
  );
}

interface CommitArgs {
  fileId: number;
  ownerId: number;
  providerId: number;
  ref: ObjectRef;
  mimeType: string;
  fileSize: number;
  width: number;
  height: number;
  checksum: string;
  allocationReason: Record<string, unknown>;
}

export async function commitAsset(a: CommitArgs): Promise<{ asset: ThumbnailAsset; replaced: ThumbnailAsset | null }> {
  return db.transaction(async (tx) => {
    // Serialise concurrent uploads/removals for the same file and re-check ownership.
    const locked = await tx.execute(sql`SELECT id FROM files WHERE id = ${a.fileId} AND user_id = ${a.ownerId} FOR UPDATE`);
    if (!locked.rows.length) throw new ThumbnailError("not_found", "File not found", 404);

    const [old] = await tx
      .update(thumbnailAssets)
      .set({ status: "pending_delete", updatedAt: new Date() })
      .where(and(eq(thumbnailAssets.fileId, a.fileId), eq(thumbnailAssets.status, "active")))
      .returning();

    const [asset] = await tx
      .insert(thumbnailAssets)
      .values({
        fileId: a.fileId,
        ownerId: a.ownerId,
        providerId: a.providerId,
        providerObjectKey: a.ref.objectKey,
        deliveryMetadata: a.ref.deliveryMetadata,
        allocationReason: a.allocationReason,
        mimeType: a.mimeType,
        fileSize: a.fileSize,
        width: a.width,
        height: a.height,
        checksum: a.checksum,
        status: "active",
      })
      .returning();
    return { asset, replaced: old ?? null };
  });
}

/** Deletes a pending_delete asset's remote object, then its row. Safe to retry. */
export async function purgeAsset(assetId: number): Promise<boolean> {
  const [asset] = await db
    .select()
    .from(thumbnailAssets)
    .where(and(eq(thumbnailAssets.id, assetId), eq(thumbnailAssets.status, "pending_delete")))
    .limit(1);
  if (!asset) return true;
  const row = await getProviderById(asset.providerId);
  if (!row) return false;
  const adapter = getAdapter(row.providerKey as ProviderKey);
  if (!adapter.isConfigured()) return false;
  try {
    await adapter.delete(refOf(asset));
  } catch (err) {
    await handleProviderError(row, err, "delete");
    return false;
  }
  await db.delete(thumbnailAssets).where(and(eq(thumbnailAssets.id, asset.id), eq(thumbnailAssets.status, "pending_delete")));
  await recordUsageDelta(row.id, { storage: -asset.fileSize, requests: 1 });
  return true;
}

/** Marks a file's active thumbnail for deletion; returns affected asset ids. Owner-scoped. */
export async function markThumbnailPendingDelete(fileId: number, ownerId: number): Promise<number[]> {
  return db.transaction(async (tx) => {
    const locked = await tx.execute(sql`SELECT id FROM files WHERE id = ${fileId} AND user_id = ${ownerId} FOR UPDATE`);
    if (!locked.rows.length) throw new ThumbnailError("not_found", "File not found", 404);
    const rows = await tx
      .update(thumbnailAssets)
      .set({ status: "pending_delete", updatedAt: new Date() })
      .where(and(eq(thumbnailAssets.fileId, fileId), eq(thumbnailAssets.status, "active")))
      .returning({ id: thumbnailAssets.id });
    return rows.map((r) => r.id);
  });
}

export async function removeThumbnail(fileId: number, ownerId: number): Promise<{ removed: boolean }> {
  const ids = await markThumbnailPendingDelete(fileId, ownerId);
  for (const id of ids) await purgeAsset(id).catch(() => false);
  return { removed: ids.length > 0 };
}

export async function purgeAssets(ids: number[]): Promise<void> {
  for (const id of ids) await purgeAsset(id).catch(() => false);
}

export async function getActiveThumbnail(fileId: number): Promise<{ asset: ThumbnailAsset; provider: ProviderRow } | null> {
  const [row] = await db
    .select({ asset: thumbnailAssets, provider: storageProviders })
    .from(thumbnailAssets)
    .innerJoin(storageProviders, eq(storageProviders.id, thumbnailAssets.providerId))
    .where(and(eq(thumbnailAssets.fileId, fileId), eq(thumbnailAssets.status, "active")))
    .limit(1);
  return row ?? null;
}

/** Thumbnail summary for a set of files (used by list endpoints). */
export async function getThumbnailVersions(fileIds: number[]): Promise<Map<number, { updatedAt: Date; width: number; height: number }>> {
  if (!fileIds.length) return new Map();
  const rows = await db
    .select({ fileId: thumbnailAssets.fileId, updatedAt: thumbnailAssets.updatedAt, width: thumbnailAssets.width, height: thumbnailAssets.height })
    .from(thumbnailAssets)
    .where(and(inArray(thumbnailAssets.fileId, fileIds), eq(thumbnailAssets.status, "active")));
  return new Map(rows.filter((r) => r.fileId !== null).map((r) => [r.fileId as number, { updatedAt: r.updatedAt, width: r.width, height: r.height }]));
}

const NO_STORE_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

/**
 * Builds the HTTP response for an already-AUTHORISED thumbnail request.
 *  - provider supports client-safe expiring URLs  -> 302 to a short-lived signed URL
 *  - otherwise (e.g. Cloudinary Free)             -> bytes are fetched server-side and streamed
 * Permanent, unrestricted provider URLs are never returned to clients.
 */
export async function deliverThumbnail(fileId: number): Promise<Response> {
  const found = await getActiveThumbnail(fileId);
  if (!found) return Response.json({ error: "No thumbnail" }, { status: 404 });
  const { asset, provider } = found;
  const key = provider.providerKey as ProviderKey;
  const adapter = getAdapter(key);
  const settings = await getSettings();
  if (!adapter.isConfigured()) {
    return Response.json({ error: "Thumbnail temporarily unavailable" }, { status: 502 });
  }
  const ref = refOf(asset);
  try {
    const delivery = await withRetry(() => adapter.getDeliveryUrl(ref, { expiresInSeconds: settings.signedUrlTtlSeconds }), {
      maxAttempts: 2,
      maxRetryAfterMs: 1500,
    });
    if (delivery.supported && delivery.value.clientSafe) {
      await recordDelivery(provider, asset.fileSize);
      return new Response(null, {
        status: 302,
        headers: {
          Location: delivery.value.url,
          // Shorter than the signed URL lifetime so a cached redirect never outlives its signature.
          "Cache-Control": `private, max-age=${Math.max(0, Math.min(60, settings.signedUrlTtlSeconds - 30))}`,
          ...NO_STORE_HEADERS,
        },
      });
    }
    const { buffer } = await withRetry(() => adapter.downloadForMigration(ref), { maxAttempts: 2, maxRetryAfterMs: 1500 });
    await recordDelivery(provider, buffer.length);
    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": asset.mimeType, // trusted: recorded at processing time, not provider-supplied
        "Content-Length": String(buffer.length),
        "Cache-Control": "private, max-age=300",
        "Content-Disposition": "inline",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        ...NO_STORE_HEADERS,
      },
    });
  } catch (err) {
    await handleProviderError(provider, err, "delivery");
    return Response.json({ error: "Thumbnail temporarily unavailable" }, { status: 502 });
  }
}

/** Maintenance sweep: retries remote deletion for every pending_delete asset. */
export async function purgeAssetsBatch(limit: number, deadlineMs?: number): Promise<number> {
  const pending = await db
    .select({ id: thumbnailAssets.id })
    .from(thumbnailAssets)
    .where(eq(thumbnailAssets.status, "pending_delete"))
    .orderBy(thumbnailAssets.updatedAt)
    .limit(limit);
  let purged = 0;
  for (const p of pending) {
    if (deadlineMs !== undefined && Date.now() > deadlineMs) break;
    if (await purgeAsset(p.id).catch(() => false)) purged++;
  }
  return purged;
}
