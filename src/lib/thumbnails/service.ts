import { randomBytes } from "crypto";
import { buildThumbnailUrl } from "./config";
import { getThumbnailStorage } from "./storage";
import { ImageValidationError, processThumbnail, type ProcessedThumbnail } from "./imageProcessing";
import { StorageError } from "./provider";
import { drizzleRepo, type ThumbnailRepo } from "./repo";
import { deleteOrOrphan, fail, type CleanupDeps, type ServiceFailure } from "./cleanup";

// Delete/cleanup lives in ./cleanup (no sharp import); re-exported for convenience.
export {
  removeThumbnail,
  cleanupThumbnailObject,
  findThumbnailKeyForCleanup,
  retryOrphanCleanup,
  type RemoveResult,
  type ServiceFailure,
} from "./cleanup";

export interface ThumbnailDeps extends CleanupDeps {
  process: (input: Uint8Array) => Promise<ProcessedThumbnail>;
  urlFor: (objectKey: string) => string | null;
}

export function defaultDeps(): ThumbnailDeps {
  return { repo: drizzleRepo, storage: getThumbnailStorage(), process: processThumbnail, urlFor: (k) => buildThumbnailUrl(k) };
}

export interface ThumbnailInfo {
  url: string | null;
  version: string;
  width: number;
  height: number;
  sizeBytes: number;
  mimeType: string;
}

export type UploadResult =
  | { ok: true; thumbnail: ThumbnailInfo; originalSizeBytes: number; strategy: string }
  | ServiceFailure;

/** Object names are FLAT (no slashes): DBByte's CDN URL format is /{token}/{bucket}/{file-name}. */
export function buildObjectKey(userId: number, fileId: number, version: string, extension: string): string {
  return `thumb-${userId}-${fileId}-${version}.${extension}`;
}

export function newVersion(): string {
  return randomBytes(8).toString("hex"); // 64 bits: unique + unguessable
}

function mapStorageError(err: StorageError): ServiceFailure {
  switch (err.code) {
    case "rate_limited":
      return fail(429, "rate_limited", `Thumbnail storage is busy. Please try again in ${err.retryAfter ?? 30} seconds.`, err.retryAfter);
    case "quota_exceeded":
      return fail(503, "uploads_paused", "Thumbnail uploads are temporarily unavailable. Your file is not affected.");
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

async function safeRecord(deps: ThumbnailDeps, f: Parameters<ThumbnailRepo["recordFailure"]>[0]) {
  try {
    await deps.repo.recordFailure(f);
  } catch (e) {
    console.error("thumbnail_failure_log_failed", e instanceof Error ? e.message : "unknown_error");
  }
}

/**
 * Upload or replace the thumbnail of a file owned by `userId`.
 * `userId` MUST come from the verified server-side session — never from the client.
 *
 * Replace order (never leaves the file without a valid thumbnail):
 *   1. validate+optimize  2. upload NEW object (verified)  3. DB commit (new row/version)
 *   4. only then delete the OLD object (failure -> orphan queue, UI already points at the new one).
 */
export async function uploadThumbnail(
  input: { userId: number; fileId: number; bytes: Uint8Array },
  deps: ThumbnailDeps = defaultDeps()
): Promise<UploadResult> {
  const { userId, fileId } = input;

  if (!(await deps.repo.findOwnedFile(userId, fileId))) {
    return fail(404, "not_found", "File not found.");
  }
  if (!deps.storage) {
    return fail(503, "storage_unavailable", "Thumbnail storage is not available right now.");
  }

  try {
    const gate = await deps.repo.getUploadGate();
    if (!gate.allowed) {
      return fail(503, "uploads_paused", "Thumbnail uploads are temporarily paused. Please try again later.");
    }
  } catch (e) {
    // Fail open: a usage-table hiccup must not block creators.
    console.error("thumbnail_gate_failed", e instanceof Error ? e.message : "unknown_error");
  }

  let processed: ProcessedThumbnail;
  try {
    processed = await deps.process(input.bytes);
  } catch (err) {
    if (err instanceof ImageValidationError) return fail(imageErrorStatus(err.code), err.code, err.message);
    console.error("thumbnail_process_failed", err instanceof Error ? err.message : "unknown_error");
    return fail(500, "processing_failed", "Could not process this image.");
  }

  const version = newVersion();
  const requestedKey = buildObjectKey(userId, fileId, version, processed.extension);

  let storedKey: string;
  try {
    storedKey = (await deps.storage.put(requestedKey, processed.buffer, processed.mimeType)).key;
  } catch (err) {
    const se = err instanceof StorageError ? err : new StorageError("unknown", "unknown");
    await safeRecord(deps, { userId, fileId, code: se.code, httpStatus: se.status, message: se.message });
    // An ambiguous failure (timeout) may still have created the object.
    if (se.code === "timeout" || se.code === "network" || se.code === "unverified") {
      await deleteOrOrphan(deps, requestedKey, "ambiguous_upload");
    }
    return mapStorageError(se);
  }

  let previousKey: string | null;
  try {
    ({ previousKey } = await deps.repo.commitThumbnail({
      userId,
      fileId,
      objectKey: storedKey,
      version,
      mimeType: processed.mimeType,
      format: processed.format,
      sizeBytes: processed.sizeBytes,
      width: processed.width,
      height: processed.height,
    }));
  } catch (err) {
    await safeRecord(deps, { userId, fileId, code: "db_write_failed", message: err instanceof Error ? err.message : undefined });
    // Old thumbnail (if any) is untouched. Remove the object we just stored.
    await deleteOrOrphan(deps, storedKey, "db_write_failed");
    return fail(500, "db_write_failed", "Could not save the thumbnail. Please try again.");
  }

  if (previousKey && previousKey !== storedKey) {
    await deleteOrOrphan(deps, previousKey, "replace_cleanup_failed");
  }

  return {
    ok: true,
    originalSizeBytes: processed.originalSizeBytes,
    strategy: processed.strategy,
    thumbnail: {
      url: deps.urlFor(storedKey),
      version,
      width: processed.width,
      height: processed.height,
      sizeBytes: processed.sizeBytes,
      mimeType: processed.mimeType,
    },
  };
}

