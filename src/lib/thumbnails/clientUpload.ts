"use client";
/**
 * Browser-side helpers for the EXISTING per-file thumbnail endpoints
 * (POST / DELETE /api/files/:id/thumbnail → DBByte thumbnail storage).
 *
 * Only the small, optimized preview image is ever sent to Onfile; originals stay in the creator's Telegram channel.
 * Extracted from the former ThumbnailManager so the Library's Edit Details dialog can stage a thumbnail choice and
 * upload it together with the title/description on "Save" — the endpoints and storage are unchanged.
 */
import { formatBytes } from "@/lib/utils";
import { prepareImageForUpload } from "@/lib/publishing/imageCompress";
import { THUMBNAIL_MAX_BYTES, THUMBNAIL_MAX_LABEL } from "@/lib/thumbnails/limits";

export const THUMBNAIL_ACCEPT = "image/jpeg,image/png,image/webp";

export interface StoredThumbnail {
  url: string | null;
  width: number | null;
  height: number | null;
}

export type UploadPhase = "uploading" | "processing";

/** Client-side checks are a convenience only — the server re-validates the real image bytes. */
export function precheckThumbnail(file: File): string | null {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    return "Only JPEG, PNG or WebP images are allowed.";
  }
  if (file.size === 0) return "The file is empty.";
  if (file.size > THUMBNAIL_MAX_BYTES) return `Image is ${formatBytes(file.size)}. Maximum is ${THUMBNAIL_MAX_LABEL}.`;
  return null;
}

/**
 * Compresses (browser) and uploads `selected` as the file's thumbnail. Resolves with the stored thumbnail and rejects
 * with an Error carrying a user-readable message. `onProgress` reports 0-100 for the network upload; `onPhase`
 * switches to "processing" once the bytes are sent and the server is optimizing + storing.
 */
export async function uploadThumbnail(
  fileId: number,
  selected: File,
  hooks: { onProgress?: (pct: number) => void; onPhase?: (phase: UploadPhase) => void } = {}
): Promise<StoredThumbnail> {
  hooks.onPhase?.("uploading");
  hooks.onProgress?.(0);
  let toSend: File;
  try {
    toSend = await prepareImageForUpload(selected);
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : "This image couldn't be prepared for upload.");
  }

  return new Promise<StoredThumbnail>((resolve, reject) => {
    const form = new FormData();
    form.append("file", toSend);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/files/${fileId}/thumbnail`);
    xhr.responseType = "json";
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) hooks.onProgress?.(Math.round((ev.loaded / ev.total) * 100));
    };
    xhr.upload.onload = () => {
      hooks.onProgress?.(100);
      hooks.onPhase?.("processing");
    };
    const networkError = () => reject(new Error("Network error. Please check your connection and try again."));
    xhr.onerror = networkError;
    xhr.ontimeout = networkError;
    xhr.timeout = 60_000;
    xhr.onload = () => {
      const data = xhr.response as { thumbnail?: { url: string | null; width: number; height: number }; error?: string } | null;
      if (xhr.status >= 200 && xhr.status < 300 && data?.thumbnail) {
        resolve({ url: data.thumbnail.url, width: data.thumbnail.width, height: data.thumbnail.height });
      } else {
        reject(new Error(data?.error || "Upload failed. Please try again."));
      }
    };
    xhr.send(form);
  });
}

/** Removes the file's custom thumbnail (the card falls back to the default artwork). Rejects with a readable Error. */
export async function deleteThumbnail(fileId: number): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`/api/files/${fileId}/thumbnail`, { method: "DELETE" });
  } catch {
    throw new Error("Network error. Please try again.");
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(data?.error || "Could not remove the thumbnail.");
  }
}
