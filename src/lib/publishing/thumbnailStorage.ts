import { THUMBNAIL_ACCEPTED_TYPES, THUMBNAIL_MAX_BYTES } from "./constants";

/**
 * Storage-service boundary for the Publish flow's Thumbnail picker.
 *
 * The existing thumbnail storage (DBByte, src/lib/thumbnails/*, which is keyed
 * by an already-existing file id and is scheduled to be replaced) is
 * deliberately NOT used here. The Post Details screen talks only to this
 * interface; when the replacement backend exists, implement
 * `ThumbnailStorageService` against it and change the single export at the
 * bottom of this file. No UI change is required.
 *
 * Contract for implementations:
 *  - `upload` must resolve ONLY after the image is durably stored, returning an
 *    opaque `ref` that the publish request can later reference.
 *  - `upload` must reject (never resolve) on any failure.
 *  - `remove` releases a staged image the creator discarded/replaced.
 */
export interface StagedThumbnail {
  /** Opaque reference produced by the storage backend. */
  ref: string;
  /** URL the preview can render (remote URL or object URL). */
  previewUrl: string;
}

export interface ThumbnailStorageService {
  /** False when no working backend exists; the UI then disables uploading. */
  readonly available: boolean;
  readonly unavailableMessage?: string;
  upload(file: File, signal?: AbortSignal): Promise<StagedThumbnail>;
  remove(ref: string): Promise<void>;
}

export class ThumbnailStorageUnavailableError extends Error {
  constructor() {
    super("Thumbnail storage is not available.");
    this.name = "ThumbnailStorageUnavailableError";
  }
}

/** Client-side pre-checks (UX only; the real backend must re-validate). */
export function validateThumbnailFile(file: { type: string; size: number }): string | null {
  if (!(THUMBNAIL_ACCEPTED_TYPES as readonly string[]).includes(file.type)) {
    return "Use a JPEG, PNG or WebP image.";
  }
  if (file.size <= 0) return "That file is empty.";
  if (file.size > THUMBNAIL_MAX_BYTES) {
    return `Image is too large. Maximum size is ${Math.round(THUMBNAIL_MAX_BYTES / (1024 * 1024))} MB.`;
  }
  return null;
}

/** Placeholder used until the replacement storage backend is integrated. */
export const unavailableThumbnailStorage: ThumbnailStorageService = {
  available: false,
  unavailableMessage:
    "Custom thumbnails aren't available yet. Your post will use the default thumbnail, and you'll be able to add one later.",
  async upload() {
    throw new ThumbnailStorageUnavailableError();
  },
  async remove() {
    /* nothing was ever stored */
  },
};

// ─── Single integration point ─────────────────────────────────────────────────
export const thumbnailStorage: ThumbnailStorageService = unavailableThumbnailStorage;
