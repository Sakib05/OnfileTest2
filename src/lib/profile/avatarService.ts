import { randomBytes } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { buildThumbnailUrl } from "@/lib/thumbnails/config";
import { getThumbnailStorage } from "@/lib/thumbnails/storage";
import { ImageValidationError, processThumbnail, type ProcessedThumbnail } from "@/lib/thumbnails/imageProcessing";
import { StorageError, type ThumbnailStorage } from "@/lib/thumbnails/provider";
import { drizzleRepo, type ThumbnailRepo } from "@/lib/thumbnails/repo";
import { deleteOrOrphan, fail, type ServiceFailure } from "@/lib/thumbnails/cleanup";

/**
 * Custom profile picture storage. Deliberately built on the EXISTING thumbnail pipeline — no new storage
 * system: same `ThumbnailStorage` provider seam (DBByte), same server-side validation/optimisation
 * (`processThumbnail`: magic-byte sniffing, decoder cross-check, animated/oversize rejection, re-encode),
 * same orphan-cleanup queue, same upload gate. Only the optimised image is stored; the original upload is
 * discarded. The DB keeps just the object key (`users.profile_image_key`).
 */

export interface AvatarRepo {
  getKey(userId: number): Promise<string | null>;
  setKey(userId: number, key: string | null): Promise<void>;
}

export const drizzleAvatarRepo: AvatarRepo = {
  async getKey(userId) {
    const [row] = await db.select({ key: users.profileImageKey }).from(users).where(eq(users.id, userId)).limit(1);
    return row?.key ?? null;
  },
  async setKey(userId, key) {
    await db.update(users).set({ profileImageKey: key, updatedAt: new Date() }).where(eq(users.id, userId));
  },
};

export interface AvatarDeps {
  avatars: AvatarRepo;
  /** Thumbnail repo: used only for the orphan queue + the shared upload gate. */
  repo: Pick<ThumbnailRepo, "addOrphan" | "getUploadGate" | "recordFailure">;
  storage: ThumbnailStorage | null;
  process: (input: Uint8Array) => Promise<ProcessedThumbnail>;
  urlFor: (key: string) => string | null;
}

export function defaultAvatarDeps(): AvatarDeps {
  return {
    avatars: drizzleAvatarRepo,
    repo: drizzleRepo,
    storage: getThumbnailStorage(),
    process: processThumbnail,
    urlFor: (k) => buildThumbnailUrl(k),
  };
}

/** Flat object name (DBByte URLs are /{token}/{bucket}/{file-name}); random version → immutable, cache-safe URL. */
export function buildAvatarObjectKey(userId: number, extension: string): string {
  return `avatar-${userId}-${randomBytes(8).toString("hex")}.${extension}`;
}

export type AvatarUploadResult = { ok: true; url: string | null } | ServiceFailure;
export type AvatarRemoveResult = { ok: true; removed: boolean } | ServiceFailure;

function imageErrorStatus(code: ImageValidationError["code"]): number {
  if (code === "too_large") return 413;
  if (code === "unsupported_type") return 415;
  return 400;
}

function mapStorageError(err: StorageError): ServiceFailure {
  switch (err.code) {
    case "rate_limited":
      return fail(429, "rate_limited", `Image storage is busy. Please try again in ${err.retryAfter ?? 30} seconds.`, err.retryAfter);
    case "quota_exceeded":
      return fail(503, "uploads_paused", "Picture uploads are temporarily unavailable. Your profile is not affected.");
    case "too_large":
      return fail(413, "too_large", "Image is too large for storage.");
    case "auth":
    case "not_configured":
      return fail(503, "storage_unavailable", "Picture storage is not available right now.");
    default:
      return fail(502, "storage_error", "Picture storage had a problem. Please try again.");
  }
}

/**
 * Upload or replace the custom picture of `userId` (MUST come from the verified session).
 * Order (never leaves the user without a valid picture):
 *   1. validate + optimise  2. store NEW object  3. commit key to DB  4. only then delete the OLD object
 *   (a failed delete goes to the orphan queue; the UI already points at the new picture).
 */
export async function uploadProfileImage(
  input: { userId: number; bytes: Uint8Array },
  deps: AvatarDeps = defaultAvatarDeps()
): Promise<AvatarUploadResult> {
  const { userId } = input;
  if (!deps.storage) return fail(503, "storage_unavailable", "Picture storage is not available right now.");

  try {
    const gate = await deps.repo.getUploadGate();
    if (!gate.allowed) return fail(503, "uploads_paused", "Picture uploads are temporarily paused. Please try again later.");
  } catch (e) {
    // Fail open: a usage-table hiccup must not block users.
    console.error("avatar_gate_failed", e instanceof Error ? e.message : "unknown_error");
  }

  let processed: ProcessedThumbnail;
  try {
    processed = await deps.process(input.bytes);
  } catch (err) {
    if (err instanceof ImageValidationError) return fail(imageErrorStatus(err.code), err.code, err.message);
    console.error("avatar_process_failed", err instanceof Error ? err.message : "unknown_error");
    return fail(500, "processing_failed", "Could not process this image.");
  }

  const requestedKey = buildAvatarObjectKey(userId, processed.extension);
  let storedKey: string;
  try {
    storedKey = (await deps.storage.put(requestedKey, processed.buffer, processed.mimeType)).key;
  } catch (err) {
    const se = err instanceof StorageError ? err : new StorageError("unknown", "unknown");
    try {
      await deps.repo.recordFailure({ userId, code: `avatar_${se.code}`, httpStatus: se.status, message: se.message });
    } catch {
      /* diagnostics only */
    }
    if (se.code === "timeout" || se.code === "network" || se.code === "unverified") {
      await deleteOrOrphan({ repo: deps.repo as ThumbnailRepo, storage: deps.storage }, requestedKey, "avatar_ambiguous_upload");
    }
    return mapStorageError(se);
  }

  let previousKey: string | null = null;
  try {
    previousKey = await deps.avatars.getKey(userId);
    await deps.avatars.setKey(userId, storedKey);
  } catch (err) {
    console.error("avatar_db_write_failed", err instanceof Error ? err.message : "unknown_error");
    await deleteOrOrphan({ repo: deps.repo as ThumbnailRepo, storage: deps.storage }, storedKey, "avatar_db_write_failed");
    return fail(500, "db_write_failed", "Could not save your picture. Please try again.");
  }

  if (previousKey && previousKey !== storedKey) {
    await deleteOrOrphan({ repo: deps.repo as ThumbnailRepo, storage: deps.storage }, previousKey, "avatar_replace_cleanup_failed");
  }
  return { ok: true, url: deps.urlFor(storedKey) };
}

/**
 * Removes the custom picture. The DB reference is cleared FIRST (so every surface immediately falls back to the
 * Telegram photo, then to initials), then the stored object is deleted (failure → orphan queue).
 */
export async function removeProfileImage(input: { userId: number }, deps: AvatarDeps = defaultAvatarDeps()): Promise<AvatarRemoveResult> {
  const { userId } = input;
  let key: string | null;
  try {
    key = await deps.avatars.getKey(userId);
    if (!key) return { ok: true, removed: false };
    await deps.avatars.setKey(userId, null);
  } catch (err) {
    console.error("avatar_remove_failed", err instanceof Error ? err.message : "unknown_error");
    return fail(500, "db_write_failed", "Could not remove your picture. Please try again.");
  }
  await deleteOrOrphan({ repo: deps.repo as ThumbnailRepo, storage: deps.storage }, key, "avatar_remove_cleanup_failed");
  return { ok: true, removed: true };
}
