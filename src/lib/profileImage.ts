import { randomBytes } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { buildThumbnailUrl } from "@/lib/thumbnails/config";
import { deleteOrOrphan, defaultCleanupDeps, fail, type CleanupDeps, type ServiceFailure } from "@/lib/thumbnails/cleanup";
import { ImageValidationError, isAnimatedPng, isAnimatedWebp, sniffImageType } from "@/lib/thumbnails/imageProcessing";
import { StorageError } from "@/lib/thumbnails/provider";
import { sanitizeAvatarUrl } from "@/lib/avatar";
import { PROFILE_IMAGE_MAX_BYTES, PROFILE_IMAGE_MAX_LABEL } from "@/lib/profile";

/**
 * Creator profile picture.
 *
 * Re-uses the EXISTING image storage (the provider-neutral thumbnail storage, today DBByte) — no second storage
 * system. The image is validated by magic bytes (never filename / client MIME), fully decoded by sharp, cropped to a
 * square, re-encoded as WebP (this drops EXIF/GPS and any embedded payload), and stored under a new random key.
 * Only the object key is saved on the user row; nothing is stored as base64. The previous object is deleted after the
 * new one is saved (a failed delete is recorded as an orphan, as for thumbnails).
 */

export const PROFILE_IMAGE_SIZE = 512;
const MAX_INPUT_PIXELS = 40_000_000; // decompression-bomb guard

export interface ProcessedProfileImage {
  buffer: Buffer;
  mimeType: "image/webp";
  extension: "webp";
  width: number;
  height: number;
}

export async function processProfileImage(input: Uint8Array): Promise<ProcessedProfileImage> {
  if (!input || input.byteLength === 0) throw new ImageValidationError("empty", "The file is empty.");
  if (input.byteLength > PROFILE_IMAGE_MAX_BYTES) {
    throw new ImageValidationError("too_large", `Image must be ${PROFILE_IMAGE_MAX_LABEL} or smaller.`);
  }
  const detected = sniffImageType(input);
  if (!detected) throw new ImageValidationError("unsupported_type", "Only JPG, PNG and WebP images are allowed.");
  if ((detected === "png" && isAnimatedPng(input)) || (detected === "webp" && isAnimatedWebp(input))) {
    throw new ImageValidationError("animated", "Animated images are not allowed.");
  }

  const sharp = (await import("sharp")).default;
  const inputBuf = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  try {
    const open = () => sharp(inputBuf, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error", animated: false });
    const meta = await open().metadata();
    if (!meta.width || !meta.height) throw new ImageValidationError("corrupt", "Could not read the image.");
    if ((meta.pages ?? 1) > 1) throw new ImageValidationError("animated", "Animated images are not allowed.");
    const metaFormat = meta.format === "jpg" ? "jpeg" : meta.format;
    if (metaFormat !== detected) {
      throw new ImageValidationError("unsupported_type", "Only JPG, PNG and WebP images are allowed.");
    }
    const buffer = await open()
      .rotate() // honour EXIF orientation, then metadata is dropped on re-encode
      .resize({ width: PROFILE_IMAGE_SIZE, height: PROFILE_IMAGE_SIZE, fit: "cover", position: "centre" })
      .webp({ quality: 85, effort: 4 })
      .toBuffer();
    return { buffer, mimeType: "image/webp", extension: "webp", width: PROFILE_IMAGE_SIZE, height: PROFILE_IMAGE_SIZE };
  } catch (err) {
    if (err instanceof ImageValidationError) throw err;
    const msg = err instanceof Error ? err.message : "";
    if (/pixel limit|exceeds/i.test(msg)) throw new ImageValidationError("too_many_pixels", "Image dimensions are too large.");
    throw new ImageValidationError("corrupt", "This image is corrupt or cannot be read.");
  }
}

/** The URL to display for a creator: their uploaded picture if set, otherwise the existing default (Telegram photo / initial). */
export function resolveAvatarUrl(user: { profileImageKey?: string | null; avatarUrl?: string | null }): string | null {
  if (user.profileImageKey) {
    const custom = buildThumbnailUrl(user.profileImageKey);
    if (custom) return custom;
  }
  return sanitizeAvatarUrl(user.avatarUrl);
}

function mapStorageError(err: StorageError): ServiceFailure {
  switch (err.code) {
    case "rate_limited":
      return fail(429, "rate_limited", `Image storage is busy. Please try again in ${err.retryAfter ?? 30} seconds.`, err.retryAfter);
    case "quota_exceeded":
      return fail(503, "uploads_paused", "Profile picture uploads are temporarily unavailable. Please try again later.");
    case "too_large":
      return fail(413, "too_large", "Image is too large for storage.");
    case "auth":
    case "not_configured":
      return fail(503, "storage_unavailable", "Image storage is not available right now.");
    default:
      return fail(502, "storage_error", "Image storage had a problem. Please try again.");
  }
}

function imageErrorStatus(code: ImageValidationError["code"]): number {
  if (code === "too_large") return 413;
  if (code === "unsupported_type") return 415;
  return 400;
}

export type SetProfileImageResult = { ok: true; avatarUrl: string | null } | ServiceFailure;

export interface ProfileImageDeps extends CleanupDeps {
  process: (input: Uint8Array) => Promise<ProcessedProfileImage>;
}

export function defaultProfileImageDeps(): ProfileImageDeps {
  return { ...defaultCleanupDeps(), process: processProfileImage };
}

/** Validates, stores and activates a new profile picture for `userId` (taken from the session, never the client). */
export async function setProfileImage(
  input: { userId: number; bytes: Uint8Array },
  deps: ProfileImageDeps = defaultProfileImageDeps()
): Promise<SetProfileImageResult> {
  const { userId } = input;
  const storage = deps.storage;
  if (!storage) return fail(503, "storage_unavailable", "Image storage is not available right now.");

  let processed: ProcessedProfileImage;
  try {
    processed = await deps.process(input.bytes);
  } catch (err) {
    if (err instanceof ImageValidationError) return fail(imageErrorStatus(err.code), err.code, err.message);
    console.error("profile_image_process_failed", err instanceof Error ? err.message : "unknown_error");
    return fail(500, "processing_failed", "Could not process this image.");
  }

  const requestedKey = `avatar-${userId}-${randomBytes(8).toString("hex")}.${processed.extension}`;
  let storedKey: string;
  try {
    storedKey = (await storage.put(requestedKey, processed.buffer, processed.mimeType)).key;
  } catch (err) {
    const se = err instanceof StorageError ? err : new StorageError("unknown", "unknown");
    if (se.code === "timeout" || se.code === "network" || se.code === "unverified") {
      await deleteOrOrphan(deps, requestedKey, "avatar_ambiguous_upload");
    }
    return mapStorageError(se);
  }

  let previousKey: string | null = null;
  try {
    const [before] = await db.select({ key: users.profileImageKey }).from(users).where(eq(users.id, userId));
    previousKey = before?.key ?? null;
    await db.update(users).set({ profileImageKey: storedKey, updatedAt: new Date() }).where(eq(users.id, userId));
  } catch (err) {
    console.error("profile_image_db_failed", err instanceof Error ? err.message : "unknown_error");
    await deleteOrOrphan(deps, storedKey, "avatar_db_write_failed");
    return fail(500, "db_write_failed", "Could not save your profile picture. Please try again.");
  }

  if (previousKey && previousKey !== storedKey) await deleteOrOrphan(deps, previousKey, "avatar_replaced_cleanup_failed");
  return { ok: true, avatarUrl: buildThumbnailUrl(storedKey) };
}

/** Removes the creator's uploaded picture so the existing default avatar shows again. */
export async function removeProfileImage(userId: number, deps: CleanupDeps = defaultCleanupDeps()): Promise<{ ok: true; removed: boolean }> {
  const [before] = await db.select({ key: users.profileImageKey }).from(users).where(eq(users.id, userId));
  if (!before?.key) return { ok: true, removed: false };
  await db.update(users).set({ profileImageKey: null, updatedAt: new Date() }).where(eq(users.id, userId));
  await deleteOrOrphan(deps, before.key, "avatar_removed_cleanup_failed");
  return { ok: true, removed: true };
}
