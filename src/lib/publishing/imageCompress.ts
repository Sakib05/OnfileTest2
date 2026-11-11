import { THUMBNAIL_MAX_BYTES } from "@/lib/thumbnails/limits";

/**
 * Browser-side image shrinking before upload.
 *
 * The thumbnail limit is 2 MiB (THUMBNAIL_MAX_BYTES). Pickers already refuse
 * larger originals; this step re-encodes bigger-than-needed images (which also
 * saves mobile bandwidth) and GUARANTEES that whatever is handed to the upload
 * code is ≤ 2 MiB — or throws ImageTooLargeError with a helpful message. It is
 * a convenience/limit guard ONLY: the server re-validates and re-encodes the
 * real bytes and never trusts anything produced here.
 */
export const CLIENT_UPLOAD_LIMIT_BYTES = THUMBNAIL_MAX_BYTES;
/** Images at or below this are sent untouched. */
export const SKIP_BELOW_BYTES = 1024 * 1024;

/** Progressive attempts: [longest edge in px, encoder quality]. Most aggressive last. */
export const COMPRESSION_LADDER: ReadonlyArray<readonly [number, number]> = [
  [1600, 0.85],
  [1280, 0.8],
  [1280, 0.7],
  [1024, 0.6],
  [800, 0.5],
];

export class ImageTooLargeError extends Error {
  constructor() {
    super("This image couldn't be compressed below 2 MB. Please choose a smaller or simpler image.");
    this.name = "ImageTooLargeError";
  }
}

export type Encoder = (maxEdge: number, quality: number) => Promise<Blob | null>;

function renamed(file: File, blob: Blob): File {
  const ext = blob.type === "image/webp" ? "webp" : blob.type === "image/png" ? "png" : "jpg";
  return new File([blob], `${file.name.replace(/\.[^.]+$/, "") || "thumbnail"}.${ext}`, { type: blob.type });
}

/**
 * Pure strategy (unit-testable without a browser): returns a File whose size is
 * ≤ `limit`, preferring the original when it is already small enough.
 */
export async function fitWithinLimit(
  file: File,
  encode: Encoder | null,
  limit: number = CLIENT_UPLOAD_LIMIT_BYTES,
  skipBelow: number = SKIP_BELOW_BYTES
): Promise<File> {
  if (file.size <= Math.min(skipBelow, limit)) return file;

  if (encode) {
    for (const [edge, quality] of COMPRESSION_LADDER) {
      let blob: Blob | null = null;
      try {
        blob = await encode(edge, quality);
      } catch {
        blob = null;
      }
      if (blob && blob.size > 0 && blob.size <= limit && blob.size < file.size) return renamed(file, blob);
    }
  }

  // Nothing smaller was produced; the original is acceptable only if it fits.
  if (file.size <= limit) return file;
  throw new ImageTooLargeError();
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality));
}

/** Canvas-based encoder for a given source file, or null when the browser can't decode it. */
async function canvasEncoder(file: File): Promise<Encoder | null> {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return null;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return null; // corrupt/undecodable → let the original-size check decide; the server re-validates
  }
  return async (maxEdge, quality) => {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    // WebP keeps transparency and is small; some browsers silently return PNG instead.
    const webp = await canvasToBlob(canvas, "image/webp", quality);
    if (webp && webp.type === "image/webp") return webp;
    return canvasToBlob(canvas, "image/jpeg", quality);
  };
}

/** Returns a File that is safe to POST (≤ 2 MiB), shrinking the original when helpful. */
export async function prepareImageForUpload(file: File): Promise<File> {
  if (file.size <= SKIP_BELOW_BYTES) return file;
  const encode = await canvasEncoder(file);
  return fitWithinLimit(file, encode);
}
