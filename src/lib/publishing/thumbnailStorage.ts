import { THUMBNAIL_ACCEPTED_TYPES, THUMBNAIL_MAX_BYTES } from "./constants";
import { prepareImageForUpload } from "./imageCompress";

/**
 * Storage-service boundary for the Publish flow's Thumbnail picker.
 *
 * The Post Details screen talks ONLY to the `ThumbnailStorageService`
 * interface below. The concrete implementation (`apiThumbnailStorage`) calls
 * Onfile's own server API (POST/DELETE /api/thumbnails), which validates the
 * image and forwards it to whichever storage provider the server is configured
 * with (src/lib/thumbnails/storage.ts). Provider credentials never reach the
 * browser, and swapping providers needs no change here or in the UI.
 *
 * Contract for implementations:
 *  - `upload` resolves ONLY after the image is durably stored, returning an
 *    opaque `ref` that the publish request references (`thumbnailRef`).
 *  - `upload` rejects (never resolves) on any failure, with a user-readable message.
 *  - `remove` releases a staged image the creator discarded/replaced.
 */
export interface StagedThumbnail {
  /** Opaque reference produced by the storage backend. */
  ref: string;
  /** Stable public URL the preview can render (never a blob:/object URL). */
  previewUrl: string;
}

export interface UploadOptions {
  signal?: AbortSignal;
  /** Called with 0-100 while bytes are being sent. */
  onProgress?: (percent: number) => void;
  /** Called when all bytes are sent and the server is optimizing/storing. */
  onProcessing?: () => void;
}

export interface ThumbnailStorageService {
  /** False when no working backend exists; the UI then disables uploading. */
  readonly available: boolean;
  readonly unavailableMessage?: string;
  upload(file: File, options?: UploadOptions): Promise<StagedThumbnail>;
  remove(ref: string): Promise<void>;
}

export class ThumbnailStorageUnavailableError extends Error {
  constructor() {
    super("Thumbnail storage is not available.");
    this.name = "ThumbnailStorageUnavailableError";
  }
}

/** Upload failure carrying a message that is safe to show to the creator. */
export class ThumbnailUploadError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(message: string, status = 0, code?: string) {
    super(message);
    this.name = "ThumbnailUploadError";
    this.status = status;
    this.code = code;
  }
}

/** Client-side pre-checks (UX only; the server re-validates the real image bytes). */
export function validateThumbnailFile(file: { type: string; size: number }): string | null {
  if (!(THUMBNAIL_ACCEPTED_TYPES as readonly string[]).includes(file.type)) {
    return "Unsupported file. Please choose a JPEG, PNG or WebP image.";
  }
  if (file.size <= 0) return "That file is empty.";
  if (file.size > THUMBNAIL_MAX_BYTES) {
    return `Image is too large. Maximum size is ${Math.round(THUMBNAIL_MAX_BYTES / (1024 * 1024))} MB.`;
  }
  return null;
}

function messageFor(status: number, serverMessage?: string): string {
  if (serverMessage && status !== 0) return serverMessage;
  if (status === 401) return "Your session has expired. Please reopen Onfile from Telegram.";
  if (status === 413) return "That image is too large. Please choose a smaller one.";
  return "The thumbnail couldn't be uploaded. Please try again.";
}

/** Real implementation: uploads through Onfile's server, which talks to the storage provider. */
export const apiThumbnailStorage: ThumbnailStorageService = {
  available: true,

  async upload(file, options = {}) {
    const toSend = await prepareImageForUpload(file).catch((e: unknown) => {
      throw new ThumbnailUploadError(e instanceof Error ? e.message : "This image couldn't be prepared for upload.");
    });

    return new Promise<StagedThumbnail>((resolve, reject) => {
      const form = new FormData();
      form.append("file", toSend);
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/thumbnails");
      xhr.responseType = "json";
      xhr.timeout = 60_000;

      const onAbort = () => xhr.abort();
      options.signal?.addEventListener("abort", onAbort, { once: true });
      const cleanup = () => options.signal?.removeEventListener("abort", onAbort);

      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable) options.onProgress?.(Math.round((ev.loaded / ev.total) * 100));
      };
      xhr.upload.onload = () => {
        options.onProgress?.(100);
        options.onProcessing?.();
      };
      xhr.onerror = () => {
        cleanup();
        reject(new ThumbnailUploadError("Network problem. Check your connection and try again."));
      };
      xhr.ontimeout = () => {
        cleanup();
        reject(new ThumbnailUploadError("The upload took too long. Check your connection and try again."));
      };
      xhr.onabort = () => {
        cleanup();
        reject(new ThumbnailUploadError("Upload cancelled."));
      };
      xhr.onload = () => {
        cleanup();
        const data = xhr.response as { thumbnail?: { ref?: string; url?: string | null }; error?: string; code?: string } | null;
        const t = data?.thumbnail;
        if (xhr.status >= 200 && xhr.status < 300 && t?.ref && typeof t.url === "string" && t.url) {
          resolve({ ref: t.ref, previewUrl: t.url });
        } else {
          reject(new ThumbnailUploadError(messageFor(xhr.status, data?.error), xhr.status, data?.code));
        }
      };
      xhr.send(form);
    });
  },

  async remove(ref) {
    const res = await fetch(`/api/thumbnails/${encodeURIComponent(ref)}`, { method: "DELETE" });
    if (!res.ok) throw new ThumbnailUploadError("The thumbnail couldn't be removed. Please try again.", res.status);
  },
};

/** Single integration point used by the Publish flow. */
export const thumbnailStorage: ThumbnailStorageService = apiThumbnailStorage;
