import { randomBytes } from "crypto";
import { and, eq, lt } from "drizzle-orm";
import { db } from "@/db";
import { fileThumbnails, thumbnailUploads } from "@/db/schema";
import { buildThumbnailUrl } from "./config";
import { ImageValidationError, processThumbnail, type ProcessedThumbnail } from "./imageProcessing";
import { StorageError, type ThumbnailStorage } from "./provider";
import { drizzleRepo, type ThumbnailRepo } from "./repo";
import { deleteOrOrphan, fail, type CleanupDeps, type ServiceFailure } from "./cleanup";
import { getThumbnailStorage } from "./storage";

/**
 * Staged thumbnails: images uploaded in the Publish wizard before the post
 * (files row) exists.
 *
 * Lifecycle (thumbnail_uploads.status):
 *   staged    -> uploaded to the storage provider, owned by one user, not used by any post
 *   attached  -> claimed by publishPost inside its DB transaction (a file_thumbnails row now exists)
 *   discarded -> the creator removed/replaced it before publishing (object deleted)
 *   expired   -> never published within STAGED_TTL_MS (object deleted by the lazy purge)
 *
 * Safety rule: an object is only ever deleted after flipping `staged` ->
 * `discarded|expired` with a conditional UPDATE. An `attached` row can therefore
 * never be deleted here, even if two requests race (e.g. discard vs. publish).
 */

export const STAGED_TTL_MS = 24 * 60 * 60 * 1000;
export const REF_PATTERN = /^[a-f0-9]{24}$/;

export interface StagedDeps extends CleanupDeps {
  process: (input: Uint8Array) => Promise<ProcessedThumbnail>;
  urlFor: (objectKey: string) => string | null;
}

export function defaultStagedDeps(): StagedDeps {
  return {
    repo: drizzleRepo,
    storage: getThumbnailStorage(),
    process: processThumbnail,
    urlFor: (k) => buildThumbnailUrl(k),
  };
}

function defaultCleanupDeps(): CleanupDeps {
  return { repo: drizzleRepo, storage: getThumbnailStorage() };
}

export interface StagedThumbnailInfo {
  ref: string;
  url: string | null;
  width: number;
  height: number;
  sizeBytes: number;
  mimeType: string;
}

export type StageResult = { ok: true; thumbnail: StagedThumbnailInfo } | ServiceFailure;

function mapStorageError(err: StorageError): ServiceFailure {
  switch (err.code) {
    case "rate_limited":
      return fail(429, "rate_limited", `Thumbnail storage is busy. Please try again in ${err.retryAfter ?? 30} seconds.`, err.retryAfter);
    case "quota_exceeded":
      return fail(503, "uploads_paused", "Thumbnail uploads are temporarily unavailable. You can publish now and add a thumbnail later.");
    case "too_large":
      return fail(413, "too_large", "Image is too large for storage.");
    case "auth":
    case "not_configured":
      return fail(503, "storage_unavailable", "Thumbnail storage is not available right now.");
    default:
      return fail(502, "storage_error", "Thumbnail storage had a problem. Please try again.");
  }
}

function imageErrorStatus(code: ImageValidationError["code"]): number {
  if (code === "too_large") return 413;
  if (code === "unsupported_type") return 415;
  return 400;
}

/** Validate + optimise + store an image for `userId` (taken from the session, never the client). */
export async function stageThumbnail(
  input: { userId: number; bytes: Uint8Array },
  deps: StagedDeps = defaultStagedDeps()
): Promise<StageResult> {
  const { userId } = input;
  const storage = deps.storage;
  if (!storage) return fail(503, "storage_unavailable", "Thumbnail storage is not available right now.");

  try {
    const gate = await deps.repo.getUploadGate();
    if (!gate.allowed) return fail(503, "uploads_paused", "Thumbnail uploads are temporarily paused. You can publish now and add a thumbnail later.");
  } catch (e) {
    console.error("thumbnail_gate_failed", e instanceof Error ? e.message : "unknown_error"); // fail open
  }

  let processed: ProcessedThumbnail;
  try {
    processed = await deps.process(input.bytes);
  } catch (err) {
    if (err instanceof ImageValidationError) return fail(imageErrorStatus(err.code), err.code, err.message);
    console.error("thumbnail_process_failed", err instanceof Error ? err.message : "unknown_error");
    return fail(500, "processing_failed", "Could not process this image.");
  }

  const version = randomBytes(8).toString("hex");
  const ref = randomBytes(12).toString("hex");
  // Flat object name (DBByte CDN URL format has no folders). Unique per upload -> never overwrites.
  const requestedKey = `thumb-${userId}-staged-${version}.${processed.extension}`;

  let storedKey: string;
  try {
    storedKey = (await storage.put(requestedKey, processed.buffer, processed.mimeType)).key;
  } catch (err) {
    const se = err instanceof StorageError ? err : new StorageError("unknown", "unknown");
    try {
      await deps.repo.recordFailure({ userId, code: se.code, httpStatus: se.status, message: se.message });
    } catch {
      /* logging must never mask the upload failure */
    }
    if (se.code === "timeout" || se.code === "network" || se.code === "unverified") {
      await deleteOrOrphan(deps, requestedKey, "ambiguous_upload");
    }
    return mapStorageError(se);
  }

  try {
    await db.insert(thumbnailUploads).values({
      ref,
      userId,
      provider: storage.provider,
      objectKey: storedKey,
      version,
      mimeType: processed.mimeType,
      format: processed.format,
      sizeBytes: processed.sizeBytes,
      width: processed.width,
      height: processed.height,
      status: "staged",
    });
  } catch (err) {
    console.error("thumbnail_stage_db_failed", err instanceof Error ? err.message : "unknown_error");
    await deleteOrOrphan(deps, storedKey, "db_write_failed");
    return fail(500, "db_write_failed", "Could not save the thumbnail. Please try again.");
  }

  // Opportunistic housekeeping; never affects this request's outcome.
  void purgeStaleStagedThumbnails({ repo: deps.repo, storage: deps.storage }).catch(() => undefined);

  return {
    ok: true,
    thumbnail: {
      ref,
      url: deps.urlFor(storedKey),
      width: processed.width,
      height: processed.height,
      sizeBytes: processed.sizeBytes,
      mimeType: processed.mimeType,
    },
  };
}

/**
 * Discard a still-unused staged thumbnail that belongs to `userId`.
 * Returns removed:false (not an error) when it is unknown, someone else's, or
 * already attached to a post — so a stale client can never delete a live image.
 */
export async function discardStagedThumbnail(
  input: { userId: number; ref: string },
  deps: CleanupDeps = defaultCleanupDeps()
): Promise<{ removed: boolean }> {
  if (!REF_PATTERN.test(input.ref)) return { removed: false };
  const [row] = await db
    .update(thumbnailUploads)
    .set({ status: "discarded", updatedAt: new Date() })
    .where(and(eq(thumbnailUploads.ref, input.ref), eq(thumbnailUploads.userId, input.userId), eq(thumbnailUploads.status, "staged")))
    .returning({ objectKey: thumbnailUploads.objectKey });
  if (!row) return { removed: false };
  await deleteOrOrphan(deps, row.objectKey, "staged_discarded");
  return { removed: true };
}

/** Expire + delete staged thumbnails that were never published. Attached rows are never touched. */
export async function purgeStaleStagedThumbnails(
  deps: CleanupDeps = defaultCleanupDeps(),
  now: Date = new Date(),
  limit = 10
): Promise<number> {
  const cutoff = new Date(now.getTime() - STAGED_TTL_MS);
  const stale = await db
    .select({ id: thumbnailUploads.id })
    .from(thumbnailUploads)
    .where(and(eq(thumbnailUploads.status, "staged"), lt(thumbnailUploads.createdAt, cutoff)))
    .limit(limit);
  let purged = 0;
  for (const { id } of stale) {
    // Claim first (conditional update) so a concurrent publish that attached it wins.
    const [row] = await db
      .update(thumbnailUploads)
      .set({ status: "expired", updatedAt: new Date() })
      .where(and(eq(thumbnailUploads.id, id), eq(thumbnailUploads.status, "staged")))
      .returning({ objectKey: thumbnailUploads.objectKey });
    if (!row) continue;
    await deleteOrOrphan(deps, row.objectKey, "staged_expired");
    purged++;
  }
  return purged;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Called INSIDE the publish transaction. Locks the staged row, verifies it is
 * the publishing user's own, unused upload, then links it to the new file by
 * inserting the `file_thumbnails` row and marking the staged row attached.
 * Returns false (nothing changed) if the ref is not claimable.
 */
export async function claimStagedThumbnail(tx: Tx, input: { userId: number; ref: string; fileId: number }): Promise<boolean> {
  if (!REF_PATTERN.test(input.ref)) return false;
  const [row] = await tx
    .select()
    .from(thumbnailUploads)
    .where(and(eq(thumbnailUploads.ref, input.ref), eq(thumbnailUploads.userId, input.userId), eq(thumbnailUploads.status, "staged")))
    .for("update");
  if (!row) return false;

  await tx.insert(fileThumbnails).values({
    userId: input.userId,
    fileId: input.fileId,
    provider: row.provider,
    objectKey: row.objectKey,
    version: row.version,
    mimeType: row.mimeType,
    format: row.format,
    sizeBytes: row.sizeBytes,
    width: row.width,
    height: row.height,
    status: "ready",
  });
  await tx
    .update(thumbnailUploads)
    .set({ status: "attached", fileId: input.fileId, updatedAt: new Date() })
    .where(eq(thumbnailUploads.id, row.id));
  return true;
}
