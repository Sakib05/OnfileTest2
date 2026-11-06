/**
 * Server-side thumbnail validation + optimization.
 *
 * `sharp` is loaded with a dynamic import INSIDE processThumbnail() only, so
 * no other route/module ever pulls the native binary into its bundle or
 * cold-start path (Next.js also externalizes `sharp` automatically).
 */

export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024; // 2 MB original upload
export const MAX_DIMENSION = 1280;
const MAX_INPUT_PIXELS = 40_000_000; // decompression-bomb guard (~40 MP)

export type ImageErrorCode =
  | "empty"
  | "too_large"
  | "unsupported_type"
  | "animated"
  | "too_many_pixels"
  | "corrupt";

export class ImageValidationError extends Error {
  code: ImageErrorCode;
  constructor(code: ImageErrorCode, message: string) {
    super(message);
    this.name = "ImageValidationError";
    this.code = code;
  }
}

export type DetectedType = "jpeg" | "png" | "webp";

/** Identifies the real format from magic bytes — never from filename/MIME. */
export function sniffImageType(buf: Uint8Array): DetectedType | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) return "png";
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && // RIFF
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50 //  WEBP
  ) return "webp";
  return null;
}

const ascii = (buf: Uint8Array, off: number, len: number) =>
  String.fromCharCode(...buf.subarray(off, off + len));

/** APNG: an `acTL` chunk appears before the first IDAT. */
export function isAnimatedPng(buf: Uint8Array): boolean {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let off = 8;
  while (off + 8 <= buf.length) {
    const len = view.getUint32(off);
    const type = ascii(buf, off + 4, 4);
    if (type === "acTL") return true;
    if (type === "IDAT" || type === "IEND") return false;
    off += 12 + len;
  }
  return false;
}

/** Animated WebP: VP8X animation flag, or any ANIM/ANMF chunk. */
export function isAnimatedWebp(buf: Uint8Array): boolean {
  if (buf.length >= 21 && ascii(buf, 12, 4) === "VP8X" && (buf[20] & 0x02) !== 0) return true;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let off = 12;
  while (off + 8 <= buf.length) {
    const type = ascii(buf, off, 4);
    if (type === "ANIM" || type === "ANMF") return true;
    const len = view.getUint32(off + 4, true);
    off += 8 + len + (len % 2);
  }
  return false;
}

export interface ProcessedThumbnail {
  buffer: Buffer;
  mimeType: "image/webp" | "image/png" | "image/jpeg";
  format: "webp" | "png" | "jpeg";
  extension: "webp" | "png" | "jpg";
  width: number;
  height: number;
  sizeBytes: number;
  originalSizeBytes: number;
  hasTransparency: boolean;
  /** Which encoder won, e.g. "webp-lossy-q82". Useful for admin/debug. */
  strategy: string;
}

interface Candidate {
  buffer: Buffer;
  format: "webp" | "png" | "jpeg";
  strategy: string;
  lossy: boolean;
}

const WEBP_QUALITY = 82;
const JPEG_QUALITY = 85;

export async function processThumbnail(input: Uint8Array): Promise<ProcessedThumbnail> {
  if (!input || input.byteLength === 0) throw new ImageValidationError("empty", "The file is empty.");
  if (input.byteLength > MAX_UPLOAD_BYTES) {
    throw new ImageValidationError("too_large", "Image must be 2 MB or smaller.");
  }

  const detected = sniffImageType(input);
  if (!detected) {
    throw new ImageValidationError("unsupported_type", "Only JPEG, PNG and WebP images are allowed.");
  }
  if ((detected === "png" && isAnimatedPng(input)) || (detected === "webp" && isAnimatedWebp(input))) {
    throw new ImageValidationError("animated", "Animated images are not allowed.");
  }

  const sharp = (await import("sharp")).default;
  const inputBuf = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  const open = () =>
    sharp(inputBuf, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error", animated: false });

  let raw: { data: Buffer; info: { width: number; height: number; channels: number } };
  try {
    const meta = await open().metadata();
    if (!meta.width || !meta.height) throw new ImageValidationError("corrupt", "Could not read the image.");
    if ((meta.pages ?? 1) > 1) throw new ImageValidationError("animated", "Animated images are not allowed.");
    // The decoder must agree with the magic bytes (guards polyglot/mislabelled files).
    const metaFormat = meta.format === "jpg" ? "jpeg" : meta.format;
    if (metaFormat !== detected) {
      throw new ImageValidationError("unsupported_type", "Only JPEG, PNG and WebP images are allowed.");
    }
    // Full decode: catches truncated/corrupt data. rotate() applies EXIF
    // orientation; resize never enlarges and never distorts (fit: inside).
    raw = await open()
      .rotate()
      .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
      .raw()
      .toBuffer({ resolveWithObject: true });
  } catch (err) {
    if (err instanceof ImageValidationError) throw err;
    const msg = err instanceof Error ? err.message : "";
    if (/pixel limit|exceeds/i.test(msg)) {
      throw new ImageValidationError("too_many_pixels", "Image dimensions are too large.");
    }
    throw new ImageValidationError("corrupt", "This image is corrupt or cannot be read.");
  }

  const { width, height, channels } = raw.info;
  const hasAlphaChannel = channels === 2 || channels === 4;
  let hasTransparency = false;
  if (hasAlphaChannel) {
    for (let i = channels - 1; i < raw.data.length; i += channels) {
      if (raw.data[i] < 255) {
        hasTransparency = true;
        break;
      }
    }
  }

  // Re-wrap the decoded pixels; drop a fully opaque alpha channel (smaller output).
  const fromRaw = () => {
    const s = sharp(raw.data, { raw: { width, height, channels: channels as 1 | 2 | 3 | 4 } });
    return hasAlphaChannel && !hasTransparency ? s.removeAlpha() : s;
  };

  const candidates: Candidate[] = [];
  const pixels = width * height;

  try {
    if (hasTransparency) {
      // Transparent graphics: never flatten. Lossless WebP and optimized PNG,
      // plus a lossy-with-alpha WebP that is only accepted if dramatically smaller.
      candidates.push({
        buffer: await fromRaw().webp({ lossless: true, effort: 4 }).toBuffer(),
        format: "webp", strategy: "webp-lossless-alpha", lossy: false,
      });
      candidates.push({
        buffer: await fromRaw().png({ compressionLevel: 9, effort: 7 }).toBuffer(),
        format: "png", strategy: "png-optimized-alpha", lossy: false,
      });
      candidates.push({
        buffer: await fromRaw().webp({ quality: WEBP_QUALITY + 3, alphaQuality: 100, effort: 4 }).toBuffer(),
        format: "webp", strategy: "webp-lossy-alpha", lossy: true,
      });
    } else {
      candidates.push({
        buffer: await fromRaw().webp({ quality: WEBP_QUALITY, effort: 4 }).toBuffer(),
        format: "webp", strategy: `webp-lossy-q${WEBP_QUALITY}`, lossy: true,
      });
      // Flat graphics / screenshots (PNG sources, small images) often compress
      // better — and without artifacts — losslessly.
      if (detected === "png" || pixels <= 262_144) {
        candidates.push({
          buffer: await fromRaw().webp({ lossless: true, effort: 4 }).toBuffer(),
          format: "webp", strategy: "webp-lossless", lossy: false,
        });
      }
      if (detected === "jpeg") {
        candidates.push({
          buffer: await fromRaw().jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer(),
          format: "jpeg", strategy: `jpeg-mozjpeg-q${JPEG_QUALITY}`, lossy: true,
        });
      }
    }
  } catch {
    throw new ImageValidationError("corrupt", "This image could not be processed.");
  }

  const smallest = candidates.reduce((a, b) => (b.buffer.length < a.buffer.length ? b : a));
  let best = smallest;
  if (hasTransparency) {
    // Lossy alpha only if it saves > 50% versus the best lossless candidate.
    const bestLossless = candidates.filter((c) => !c.lossy).reduce((a, b) => (b.buffer.length < a.buffer.length ? b : a));
    const lossy = candidates.find((c) => c.lossy)!;
    best = lossy.buffer.length <= bestLossless.buffer.length * 0.5 ? lossy : bestLossless;
  } else if (smallest.format !== "webp") {
    // Prefer WebP unless another format is clearly (>5%) smaller.
    const webps = candidates.filter((c) => c.format === "webp");
    const bestWebp = webps.reduce((a, b) => (b.buffer.length < a.buffer.length ? b : a));
    if (bestWebp.buffer.length <= smallest.buffer.length * 1.05) best = bestWebp;
  }

  // Sanity-check the chosen output decodes and has the expected geometry.
  const outMeta = await sharp(best.buffer).metadata();
  if (outMeta.width !== width || outMeta.height !== height) {
    throw new ImageValidationError("corrupt", "Image processing produced an invalid result.");
  }

  const mimeType = best.format === "webp" ? "image/webp" : best.format === "png" ? "image/png" : "image/jpeg";
  return {
    buffer: best.buffer,
    mimeType,
    format: best.format,
    extension: best.format === "jpeg" ? "jpg" : best.format,
    width,
    height,
    sizeBytes: best.buffer.length,
    originalSizeBytes: input.byteLength,
    hasTransparency,
    strategy: best.strategy,
  };
}
