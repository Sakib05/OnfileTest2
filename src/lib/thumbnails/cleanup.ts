import { getThumbnailStorage } from "./storage";
import { StorageError, type ThumbnailStorage } from "./provider";
import { bumpOrphanAttempt, deleteOrphanRow, drizzleRepo, listOrphans, type ThumbnailRepo } from "./repo";

/**
 * Delete/cleanup side of thumbnail handling. Deliberately does NOT import the
 * image-processing module, so routes that only delete (file deletion, admin
 * cleanup) never pull `sharp` into their serverless function.
 */
export interface CleanupDeps {
  repo: ThumbnailRepo;
  storage: ThumbnailStorage | null;
}

export function defaultCleanupDeps(): CleanupDeps {
  return { repo: drizzleRepo, storage: getThumbnailStorage() };
}

export type ServiceFailure = {
  ok: false;
  status: number;
  code: string;
  message: string;
  retryAfter?: number;
};

export type RemoveResult = { ok: true; removed: boolean } | ServiceFailure;

export const fail = (status: number, code: string, message: string, retryAfter?: number): ServiceFailure => ({
  ok: false, status, code, message, ...(retryAfter !== undefined ? { retryAfter } : {}),
});

/** Deletes an object; on failure remembers it for a later cleanup retry. */
export async function deleteOrOrphan(deps: CleanupDeps, key: string, reason: string): Promise<boolean> {
  try {
    if (!deps.storage) throw new StorageError("not_configured", "not configured");
    await deps.storage.delete(key);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown_error";
    try {
      await deps.repo.addOrphan(key, reason, msg);
    } catch {
      // Last resort: the key is in the logs so it can be removed by hand.
      console.error("thumbnail_orphan_untracked", { key, reason });
    }
    return false;
  }
}

/**
 * Remove a file's thumbnail. DB reference first (so the UI can never point at
 * a missing image), then the DBByte object (DBByte purges its CDN cache on delete).
 */
export async function removeThumbnail(
  input: { userId: number; fileId: number },
  deps: CleanupDeps = defaultCleanupDeps()
): Promise<RemoveResult> {
  const { userId, fileId } = input;
  if (!(await deps.repo.findOwnedFile(userId, fileId))) return fail(404, "not_found", "File not found.");

  const row = await deps.repo.removeThumbnail(userId, fileId);
  if (!row) return { ok: true, removed: false };
  await deleteOrOrphan(deps, row.objectKey, "remove_cleanup_failed");
  return { ok: true, removed: true };
}

/** After a whole file is deleted: best-effort removal of its thumbnail object. */
export async function cleanupThumbnailObject(objectKey: string, deps: CleanupDeps = defaultCleanupDeps()): Promise<void> {
  await deleteOrOrphan(deps, objectKey, "file_deleted_cleanup_failed");
}

/** Looks up (never throws) the thumbnail key of an owned file, for use before the file row is deleted. */
export async function findThumbnailKeyForCleanup(userId: number, fileId: number, deps: CleanupDeps = defaultCleanupDeps()): Promise<string | null> {
  try {
    return await deps.repo.getThumbnailKey(userId, fileId);
  } catch (e) {
    console.error("thumbnail_key_lookup_failed", e instanceof Error ? e.message : "unknown_error");
    return null;
  }
}

/** Admin-triggered: retries deleting objects recorded as orphans. */
export async function retryOrphanCleanup(limit = 20, storage: ThumbnailStorage | null = getThumbnailStorage()) {
  if (!storage) return { attempted: 0, deleted: 0, failed: 0, error: "not_configured" as const };
  const orphans = await listOrphans(limit);
  let deleted = 0;
  let failed = 0;
  for (const o of orphans) {
    try {
      await storage.delete(o.objectKey);
      await deleteOrphanRow(o.id);
      deleted++;
    } catch (err) {
      failed++;
      await bumpOrphanAttempt(o.id, err instanceof Error ? err.message : "unknown_error");
      if (err instanceof StorageError && (err.code === "quota_exceeded" || err.code === "rate_limited")) break;
    }
  }
  return { attempted: deleted + failed, deleted, failed };
}
