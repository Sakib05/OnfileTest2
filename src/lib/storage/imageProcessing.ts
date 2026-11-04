import sharp, { type Metadata, type OutputInfo } from "sharp";
import { sha256Hex } from "./http";
import { MAX_UPLOAD_BYTES } from "./types";

/**
 * Safe, in-memory thumbnail processing. Nothing is written to disk and the
 * original upload is never persisted.
 *
 *  1. size / signature / MIME validation (JPEG, PNG, WebP only)
 *  2. reject animated images (animated WebP, APNG) — GIF/SVG/HTML fail the signature check
 *  3. full decode (corrupt/truncated images fail here)
 *  4. EXIF auto-orientation, then ALL metadata (EXIF/GPS/XMP/ICC) dropped
 *  5. resize to <= 1280px on the longest side (never enlarged)
 *  6. WebP quality ~85 (lossy) — lossless WebP / optimised PNG for flat graphics & logos
 *  7. alpha preserved
 *  8. an already-small CLEAN image is kept byte-for-byte; the smallest safe candidate wins
 *
 * Quality is not promised to be lossless for photographs.
 */

export const MAX_DIMENSION = 1280;
export const DEFAULT_WEBP_QUALITY = 85;
export const SMALL_CLEAN_IMAGE_BYTES = 150 * 1024;
const MAX_INPUT_PIXELS = 40_000_000;
const MAX_INPUT_SIDE = 12_000;

export type ImageRejectReason =
  | "empty"
  | "too_large"
  | "unsupported_format"
  | "mime_mismatch"
  | "animated"
  | "corrupt"
  | "invalid_dimensions";

export class ImageValidationError extends Error {
  constructor(
    public readonly reason: ImageRejectReason,
    message: string
  ) {
    super(message);
    this.name = "ImageValidationError";
  }
}

export type SniffedFormat = "jpeg" | "png" | "webp";
const MIME_FOR: Record<SniffedFormat, string> = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

export function sniffFormat(buf: Buffer): SniffedFormat | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "webp";
  return null;
}

/** APNG has an `acTL` chunk before the first IDAT. */
export function isAnimatedPng(buf: Buffer): boolean {
  let off = 8;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    if (type === "acTL") return true;
    if (type === "IDAT" || type === "IEND") return false;
    off += 12 + len;
  }
  return false;
}

export interface ProcessedImage {
  buffer: Buffer;
  mimeType: "image/webp" | "image/png" | "image/jpeg";
  extension: "webp" | "png" | "jpg";
  width: number;
  height: number;
  checksum: string;
  originalBytes: number;
  strategy: "kept_original" | "lossy_webp" | "lossless_webp" | "optimized_png";
}

export interface ProcessOptions {
  declaredMime?: string | null;
  maxBytes?: number;
  quality?: number;
}

export async function processThumbnail(input: Buffer, opts: ProcessOptions = {}): Promise<ProcessedImage> {
  const maxBytes = opts.maxBytes ?? MAX_UPLOAD_BYTES;
  const quality = opts.quality ?? DEFAULT_WEBP_QUALITY;

  if (!input || input.length === 0) throw new ImageValidationError("empty", "The image is empty.");
  if (input.length > maxBytes) {
    throw new ImageValidationError("too_large", `Image is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.`);
  }

  const format = sniffFormat(input);
  if (!format) throw new ImageValidationError("unsupported_format", "Only JPEG, PNG and WebP images are supported.");
  if (opts.declaredMime !== undefined && opts.declaredMime !== null) {
    const declared = opts.declaredMime.split(";")[0].trim().toLowerCase();
    const normalized = declared === "image/jpg" ? "image/jpeg" : declared;
    if (normalized !== MIME_FOR[format]) {
      throw new ImageValidationError("mime_mismatch", "The file type does not match its content.");
    }
  }
  if (format === "png" && isAnimatedPng(input)) throw new ImageValidationError("animated", "Animated images are not supported.");

  const base = { failOn: "error" as const, limitInputPixels: MAX_INPUT_PIXELS };
  let meta: Metadata;
  try {
    meta = await sharp(input, { ...base, animated: true }).metadata();
  } catch {
    throw new ImageValidationError("corrupt", "The image is corrupt or could not be read.");
  }
  if ((meta.pages ?? 1) > 1) throw new ImageValidationError("animated", "Animated images are not supported.");
  const w0 = meta.width ?? 0;
  const h0 = meta.height ?? 0;
  if (w0 < 1 || h0 < 1 || w0 > MAX_INPUT_SIDE || h0 > MAX_INPUT_SIDE) {
    throw new ImageValidationError("invalid_dimensions", "The image dimensions are not supported.");
  }

  // Full decode + orientation + resize. sharp drops EXIF/GPS/XMP/ICC unless asked to keep them.
  let pipelineBuf: { data: Buffer; info: OutputInfo };
  try {
    pipelineBuf = await sharp(input, base)
      .rotate()
      .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
      .toColourspace("srgb")
      .ensureAlpha(meta.hasAlpha ? undefined : 1)
      .raw()
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw new ImageValidationError("corrupt", "The image is corrupt or could not be read.");
  }
  const { width, height, channels } = pipelineBuf.info;
  const hasAlpha = !!meta.hasAlpha;
  const raw = { raw: { width, height, channels: channels as 1 | 2 | 3 | 4 } };
  const encodeInput = () => {
    const s = sharp(pipelineBuf.data, raw);
    return hasAlpha ? s : s.removeAlpha();
  };

  const flat = isFlatGraphic(pipelineBuf.data, channels, width, height);
  const candidates: { buffer: Buffer; strategy: ProcessedImage["strategy"]; mime: ProcessedImage["mimeType"] }[] = [];

  try {
    if (flat) {
      candidates.push({ buffer: await encodeInput().webp({ lossless: true, effort: 5 }).toBuffer(), strategy: "lossless_webp", mime: "image/webp" });
      candidates.push({
        buffer: await encodeInput().png({ compressionLevel: 9, effort: 7, palette: true }).toBuffer(),
        strategy: "optimized_png",
        mime: "image/png",
      });
    } else {
      candidates.push({ buffer: await encodeInput().webp({ quality, effort: 4, alphaQuality: 100 }).toBuffer(), strategy: "lossy_webp", mime: "image/webp" });
    }
  } catch {
    throw new ImageValidationError("corrupt", "The image could not be processed.");
  }

  // "Clean" original: no metadata of any kind, no pending rotation, within size limits.
  const clean =
    !meta.exif &&
    !meta.xmp &&
    !meta.iptc &&
    !meta.icc &&
    !meta.tifftagPhotoshop &&
    (meta.orientation ?? 1) === 1 &&
    w0 <= MAX_DIMENSION &&
    h0 <= MAX_DIMENSION &&
    format !== "jpeg"; // JPEG may carry comment/APP segments sharp does not report; always re-encode
  const smallestConverted = candidates.reduce((a, b) => (b.buffer.length < a.buffer.length ? b : a));
  let pick: { buffer: Buffer; strategy: ProcessedImage["strategy"]; mime: ProcessedImage["mimeType"] } = smallestConverted;
  if (clean && input.length <= SMALL_CLEAN_IMAGE_BYTES && input.length <= smallestConverted.buffer.length * 1.15) {
    pick = { buffer: input, strategy: "kept_original", mime: MIME_FOR[format] as ProcessedImage["mimeType"] };
  } else if (clean && input.length < smallestConverted.buffer.length) {
    // Conversion would increase the size: keep the smaller safe representation.
    pick = { buffer: input, strategy: "kept_original", mime: MIME_FOR[format] as ProcessedImage["mimeType"] };
  }

  const finalMeta = await sharp(pick.buffer).metadata();
  const ext = pick.mime === "image/webp" ? "webp" : pick.mime === "image/png" ? "png" : "jpg";
  return {
    buffer: pick.buffer,
    mimeType: pick.mime,
    extension: ext,
    width: finalMeta.width ?? width,
    height: finalMeta.height ?? height,
    checksum: sha256Hex(pick.buffer),
    originalBytes: input.length,
    strategy: pick.strategy,
  };
}

/** Heuristic: few distinct colours in a downsampled copy => logo/text/flat graphic. */
function isFlatGraphic(data: Buffer, channels: number, width: number, height: number): boolean {
  const total = width * height;
  const step = Math.max(1, Math.floor(total / 40000));
  const seen = new Set<number>();
  for (let px = 0; px < total; px += step) {
    const o = px * channels;
    const r = data[o] ?? 0;
    const g = data[o + 1] ?? 0;
    const b = data[o + 2] ?? 0;
    const a = channels === 4 ? data[o + 3] : 255;
    seen.add(((r << 24) | (g << 16) | (b << 8) | a) >>> 0);
    if (seen.size > 512) return false;
  }
  return true;
}
