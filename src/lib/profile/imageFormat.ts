/**
 * Pure (browser + Node safe) helpers that identify an image from its REAL bytes — never from the file name or
 * the MIME type the Android picker reports (which can be empty or wrong). Used before the cropper opens and
 * to validate the exported crop Blob before it is uploaded. The server still re-validates everything.
 */

export type SniffedFormat = "jpeg" | "png" | "webp" | "heic" | "avif" | "gif" | "unknown";

export const SUPPORTED_FORMATS = ["jpeg", "png", "webp"] as const;
export type SupportedFormat = (typeof SUPPORTED_FORMATS)[number];

export const MIME_FOR: Record<SupportedFormat, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export function isSupportedFormat(f: SniffedFormat): f is SupportedFormat {
  return f === "jpeg" || f === "png" || f === "webp";
}

const ascii = (b: Uint8Array, off: number, len: number) => String.fromCharCode(...b.subarray(off, off + len));

const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1"]);

/** Identifies the format from magic bytes. HEIC/HEIF and AVIF are recognised so they can be reported accurately. */
export function sniffImageFormat(b: Uint8Array): SniffedFormat {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (
    b.length >= 8 &&
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  ) return "png";
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return "webp";
  if (b.length >= 6 && ascii(b, 0, 4) === "GIF8") return "gif";
  if (b.length >= 12 && ascii(b, 4, 4) === "ftyp") {
    const brand = ascii(b, 8, 4);
    if (brand === "avif" || brand === "avis") return "avif";
    if (HEIC_BRANDS.has(brand)) return "heic";
  }
  return "unknown";
}

const u16be = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const u16le = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u24le = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
const u32be = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

/**
 * Reads the pixel size from the file header without decoding (so a 50 MP photo can be rejected/downscaled
 * before the browser tries to decode it). Returns null if the header is truncated/unrecognised.
 * Note: JPEG EXIF orientation is NOT applied here (the browser decoder handles that).
 */
export function readImageSize(b: Uint8Array): { width: number; height: number } | null {
  const fmt = sniffImageFormat(b);
  if (fmt === "png") {
    if (b.length < 24) return null;
    const width = u32be(b, 16);
    const height = u32be(b, 20);
    return width > 0 && height > 0 ? { width, height } : null;
  }
  if (fmt === "jpeg") {
    let o = 2;
    while (o + 4 <= b.length) {
      if (b[o] !== 0xff) return null;
      while (o < b.length && b[o] === 0xff) o++; // fill bytes
      const marker = b[o];
      o++;
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue; // no payload
      if (marker === 0xd9 || marker === 0xda) return null; // EOI / SOS before any SOF
      if (o + 2 > b.length) return null;
      const len = u16be(b, o);
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) {
        if (o + 7 > b.length) return null;
        const height = u16be(b, o + 3);
        const width = u16be(b, o + 5);
        return width > 0 && height > 0 ? { width, height } : null;
      }
      o += len;
    }
    return null;
  }
  if (fmt === "webp") {
    if (b.length < 30) return null;
    const chunk = ascii(b, 12, 4);
    if (chunk === "VP8 ") {
      if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
      return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
    }
    if (chunk === "VP8L") {
      if (b[20] !== 0x2f) return null;
      const bits = (b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)) >>> 0;
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (chunk === "VP8X") return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
  }
  return null;
}
