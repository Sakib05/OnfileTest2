/**
 * Browser-side image shrinking before upload.
 *
 * Creators may pick images up to THUMBNAIL_MAX_BYTES (5 MB), but Vercel
 * serverless functions reject request bodies larger than 4.5 MB, so large
 * photos are downscaled/re-encoded here first. This is a bandwidth/limit
 * convenience ONLY: the server re-validates and re-encodes the real bytes and
 * never trusts anything produced here.
 */
export const SERVER_BODY_LIMIT_BYTES = 4 * 1024 * 1024; // keep in sync with MAX_UPLOAD_BYTES (server)
const SKIP_BELOW_BYTES = 1.5 * 1024 * 1024;
const MAX_EDGE = 1600;

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality));
}

export class ImageTooLargeError extends Error {
  constructor() {
    super("This image is too large to upload from this device. Please choose a smaller image.");
    this.name = "ImageTooLargeError";
  }
}

/** Returns a File that is safe to POST (≤ 4 MB), shrinking the original when helpful. */
export async function prepareImageForUpload(file: File): Promise<File> {
  if (file.size <= SKIP_BELOW_BYTES) return file;

  try {
    if (typeof createImageBitmap !== "function" || typeof document === "undefined") throw new Error("unsupported");
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no-canvas");
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();

    // WebP keeps transparency and is small; some browsers silently return PNG instead.
    let blob = await canvasToBlob(canvas, "image/webp", 0.85);
    if (!blob || blob.type !== "image/webp") blob = await canvasToBlob(canvas, "image/jpeg", 0.85);
    if (blob && blob.size > 0 && blob.size < file.size) {
      const ext = blob.type === "image/webp" ? "webp" : "jpg";
      const out = new File([blob], `${file.name.replace(/\.[^.]+$/, "") || "thumbnail"}.${ext}`, { type: blob.type });
      if (out.size <= SERVER_BODY_LIMIT_BYTES) return out;
    }
  } catch {
    /* fall through to the original-file checks below */
  }

  if (file.size <= SERVER_BODY_LIMIT_BYTES) return file;
  throw new ImageTooLargeError();
}
