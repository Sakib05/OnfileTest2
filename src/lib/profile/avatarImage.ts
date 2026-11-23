"use client";
/**
 * Browser-side image pipeline for the profile picture cropper.
 *
 *   File ──► read bytes eagerly ──► sniff real format (reject HEIC/GIF/… clearly) ──► read header size
 *        ──► decode with the first strategy that works (<img>, createImageBitmap ×2, FileReader data-URL)
 *        ──► draw ONCE into a downscaled "working canvas" (≤ WORK_MAX_EDGE) and free the full-size decode
 *        ──► the cropper pans/zooms that canvas; exportCrop() writes the chosen square (≤ 512 px) as WebP/JPEG
 *        ──► validateAvatarBlob() checks the Blob's real bytes before it can be uploaded.
 *
 * The user's original file is never modified or uploaded. Every failure is an AvatarError with a precise `kind`
 * (never a blanket "corrupt image" message).
 */
import { AvatarError } from "./avatarErrors";
import { outputEdge, type CropRect } from "./cropMath";
import { isSupportedFormat, MIME_FOR, readImageSize, sniffImageFormat, type SupportedFormat } from "./imageFormat";

/** Phone photos can be large; the cropped output is tiny. Mirrors the previous limit. */
export const AVATAR_MAX_SOURCE_BYTES = 20 * 1024 * 1024;
/** Refuse absurd dimensions up front (a 120 MP bitmap alone is ~480 MB of RAM on a phone). */
export const MAX_SOURCE_PIXELS = 120_000_000;
/** Longest edge of the in-memory working copy the cropper uses (≈ 4.9 MP max → ~20 MB). */
export const WORK_MAX_EDGE = 2560;
/** Server limit for an uploaded avatar (src/lib/thumbnails/limits.ts). The 512 px export is far below it. */
export const AVATAR_MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const DECODE_TIMEOUT_MS = 20_000;

export interface CropImage {
  /** Downscaled working copy that the cropper displays and exports from. */
  canvas: HTMLCanvasElement;
  /** Working-copy dimensions (crop rectangles are expressed in these pixels). */
  width: number;
  height: number;
  /** Dimensions of the photo as decoded from the original file. */
  originalWidth: number;
  originalHeight: number;
  format: SupportedFormat;
  /** Which decoder succeeded (diagnostics). */
  decoder: string;
  /** Frees the working canvas. Safe to call more than once. */
  release(): void;
}

interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  dispose: () => void;
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label}_timeout`)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

function decodeWithImageElement(src: string, dispose: () => void): Promise<Decoded> {
  return new Promise<Decoded>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      if (!img.naturalWidth || !img.naturalHeight) {
        dispose();
        reject(new Error("zero_size"));
        return;
      }
      resolve({
        source: img,
        width: img.naturalWidth,
        height: img.naturalHeight,
        dispose: () => {
          img.onload = null;
          img.onerror = null;
          img.src = "";
          dispose();
        },
      });
    };
    img.onerror = () => {
      dispose();
      reject(new Error("img_error"));
    };
    img.src = src;
  });
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error ?? new Error("filereader_error"));
    fr.readAsDataURL(blob);
  });
}

/** Decoding strategies, tried in order. `<img>` first: every browser applies EXIF rotation to it. */
function strategies(blob: Blob): Array<{ name: string; run: () => Promise<Decoded> }> {
  const list: Array<{ name: string; run: () => Promise<Decoded> }> = [
    {
      name: "img-blob-url",
      run: () => {
        const url = URL.createObjectURL(blob);
        return withTimeout(decodeWithImageElement(url, () => URL.revokeObjectURL(url)), DECODE_TIMEOUT_MS, "img");
      },
    },
  ];
  if (typeof createImageBitmap === "function") {
    const viaBitmap = (opts?: ImageBitmapOptions) => async (): Promise<Decoded> => {
      const bmp = await withTimeout(opts ? createImageBitmap(blob, opts) : createImageBitmap(blob), DECODE_TIMEOUT_MS, "bitmap");
      return { source: bmp, width: bmp.width, height: bmp.height, dispose: () => bmp.close() };
    };
    list.push({ name: "bitmap-from-image", run: viaBitmap({ imageOrientation: "from-image" }) });
    list.push({ name: "bitmap-default", run: viaBitmap() });
  }
  list.push({
    name: "img-data-url",
    run: async () => {
      const dataUrl = await readAsDataUrl(blob);
      return withTimeout(decodeWithImageElement(dataUrl, () => {}), DECODE_TIMEOUT_MS, "img");
    },
  });
  return list;
}

/** Draws the decoded photo once into a downscaled working canvas (white behind transparent PNG/WebP). */
function toWorkCanvas(d: Decoded): HTMLCanvasElement {
  const scale = Math.min(1, WORK_MAX_EDGE / Math.max(d.width, d.height));
  const w = Math.max(1, Math.round(d.width * scale));
  const h = Math.max(1, Math.round(d.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new AvatarError("processing_failed", undefined, "no_2d_context");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(d.source, 0, 0, d.width, d.height, 0, 0, w, h);
  return canvas;
}

async function readHead(blob: Blob, n: number): Promise<Uint8Array> {
  const part = blob.slice(0, n);
  if (typeof part.arrayBuffer === "function") return new Uint8Array(await part.arrayBuffer());
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(new Uint8Array(fr.result as ArrayBuffer));
    fr.onerror = () => reject(fr.error ?? new Error("filereader_error"));
    fr.readAsArrayBuffer(part);
  });
}

/**
 * Validates a picked file and prepares it for cropping. Rejects with an AvatarError that says exactly why:
 * empty / unreadable / HEIC / unsupported / corrupt / too large / decode_failed.
 */
export async function loadCropImage(file: File): Promise<CropImage> {
  if (!file || file.size === 0) throw new AvatarError("empty");
  if (file.size > AVATAR_MAX_SOURCE_BYTES) throw new AvatarError("too_large");

  // Read the bytes NOW, while the picker's File is guaranteed readable (before the <input> is reset).
  let buffer: ArrayBuffer;
  try {
    buffer = await file.arrayBuffer();
  } catch (e) {
    throw new AvatarError("unreadable", undefined, e instanceof Error ? e.name : "read_error");
  }
  const bytes = new Uint8Array(buffer);
  if (bytes.length === 0) throw new AvatarError("empty");

  // Trust the BYTES, not the picker's MIME type / extension.
  const sniffed = sniffImageFormat(bytes);
  if (sniffed === "heic") throw new AvatarError("heic_unsupported");
  if (!isSupportedFormat(sniffed)) {
    const claimsImage = /^image\/(jpeg|jpg|png|webp)$/i.test(file.type);
    throw new AvatarError(claimsImage ? "corrupt" : "unsupported_format", undefined, `sniff_${sniffed}`);
  }
  const header = readImageSize(bytes);
  if (!header) throw new AvatarError("corrupt", undefined, `header_unreadable_${sniffed}`);
  if (header.width * header.height > MAX_SOURCE_PIXELS) {
    throw new AvatarError("too_large", "This photo's dimensions are too large. Please choose a smaller one.", `pixels_${header.width}x${header.height}`);
  }

  // A fresh Blob with the SNIFFED type: decoding no longer depends on what the Android picker reported.
  const blob = new Blob([buffer], { type: MIME_FOR[sniffed] });
  const failures: string[] = [];
  for (const s of strategies(blob)) {
    let decoded: Decoded | null = null;
    try {
      decoded = await s.run();
      const canvas = toWorkCanvas(decoded);
      const out: CropImage = {
        canvas,
        width: canvas.width,
        height: canvas.height,
        originalWidth: decoded.width,
        originalHeight: decoded.height,
        format: sniffed,
        decoder: s.name,
        release() {
          canvas.width = 0;
          canvas.height = 0;
        },
      };
      return out;
    } catch (e) {
      failures.push(`${s.name}:${e instanceof Error ? e.message || e.name : "error"}`);
      if (e instanceof AvatarError && e.kind === "processing_failed" && e.detail === "no_2d_context") throw e;
    } finally {
      decoded?.dispose(); // free the full-size decode immediately
    }
  }
  throw new AvatarError("decode_failed", undefined, failures.join("|"));
}

/** Paints the square source region onto a px×px canvas. Used by the stage, the preview AND the export. */
export function drawCrop(ctx: CanvasRenderingContext2D, work: CanvasImageSource, rect: CropRect, px: number): void {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, px, px);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(work, rect.sx, rect.sy, rect.side, rect.side, 0, 0, px, px);
}

/**
 * Checks the Blob's real bytes: non-empty, within the server's size limit, a genuine JPEG/WebP whose MIME type
 * matches, and (when the header can be read) a square no larger than 512 px. Throws processing_failed otherwise.
 */
export async function validateAvatarBlob(blob: Blob): Promise<"jpeg" | "webp"> {
  if (!blob || blob.size === 0) throw new AvatarError("processing_failed", undefined, "empty_blob");
  if (blob.size > AVATAR_MAX_UPLOAD_BYTES) throw new AvatarError("too_large", "The cropped picture is too large. Please try again.", "blob_too_large");
  let head: Uint8Array;
  try {
    head = await readHead(blob, 8192);
  } catch {
    throw new AvatarError("processing_failed", undefined, "blob_unreadable");
  }
  const fmt = sniffImageFormat(head);
  if (fmt !== "jpeg" && fmt !== "webp") throw new AvatarError("processing_failed", undefined, `blob_format_${fmt}`);
  if (blob.type && blob.type !== MIME_FOR[fmt]) throw new AvatarError("processing_failed", undefined, "blob_mime_mismatch");
  const size = readImageSize(head);
  if (size && (size.width !== size.height || size.width > 512)) {
    throw new AvatarError("processing_failed", undefined, `blob_geometry_${size.width}x${size.height}`);
  }
  return fmt;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((b) => resolve(b), type, quality);
    } catch {
      resolve(null);
    }
  });
}

/**
 * Exports the chosen square as a NEW file (the original is untouched): edge = min(512, crop resolution), WebP
 * q0.9 (falling back to JPEG where the browser can't encode WebP). The Blob is validated before it is returned.
 */
export async function exportCrop(image: CropImage, rect: CropRect): Promise<File> {
  const edge = outputEdge(rect.side);
  const canvas = document.createElement("canvas");
  canvas.width = edge;
  canvas.height = edge;
  try {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new AvatarError("processing_failed", undefined, "no_2d_context");
    drawCrop(ctx, image.canvas, rect, edge);
    const attempts: Array<[string, string]> = [
      ["image/webp", "webp"],
      ["image/jpeg", "jpg"],
    ];
    const problems: string[] = [];
    for (const [type, ext] of attempts) {
      const blob = await canvasToBlob(canvas, type, 0.9);
      if (!blob || blob.size === 0) { problems.push(`${ext}:no_blob`); continue; }
      if (blob.type !== type) { problems.push(`${ext}:got_${blob.type}`); continue; } // e.g. Safari silently returns PNG
      try {
        await validateAvatarBlob(blob);
      } catch (e) {
        problems.push(`${ext}:${e instanceof AvatarError ? e.detail : "invalid"}`);
        continue;
      }
      return new File([blob], `avatar.${ext}`, { type });
    }
    throw new AvatarError("processing_failed", undefined, problems.join("|"));
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}
