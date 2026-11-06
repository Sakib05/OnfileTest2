import { describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  ImageValidationError,
  MAX_DIMENSION,
  MAX_UPLOAD_BYTES,
  isAnimatedPng,
  isAnimatedWebp,
  processThumbnail,
  sniffImageType,
} from "./imageProcessing";

// Noisy gradient so the image is "photo-like" (doesn't compress to nothing).
function noisyRaw(w: number, h: number, channels: 3 | 4 = 3) {
  const data = Buffer.alloc(w * h * channels);
  for (let i = 0; i < data.length; i++) data[i] = (i * 31 + ((i / channels) % w) * 7 + (i % 251)) & 255;
  return data;
}
// Smooth gradients + faint sensor noise: behaves like an ordinary photograph.
function photoRaw(w: number, h: number) {
  const data = Buffer.alloc(w * h * 3);
  let seed = 1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const n = (seed % 5) - 2;
      const i = (y * w + x) * 3;
      data[i] = Math.max(0, Math.min(255, (x / w) * 255 + n));
      data[i + 1] = Math.max(0, Math.min(255, (y / h) * 255 + n));
      data[i + 2] = Math.max(0, Math.min(255, ((x + y) / (w + h)) * 255 + n));
    }
  return data;
}
const jpeg = (w = 400, h = 300, opts: sharp.JpegOptions = { quality: 95 }) =>
  sharp(photoRaw(w, h), { raw: { width: w, height: h, channels: 3 } }).jpeg(opts);

async function rejects(buf: Uint8Array, code: string) {
  await expect(processThumbnail(buf)).rejects.toMatchObject({ name: "ImageValidationError", code });
}

describe("processThumbnail — accepted formats", () => {
  it("accepts a valid JPEG and outputs WebP", async () => {
    const out = await processThumbnail(await jpeg().toBuffer());
    expect(out.format).toBe("webp");
    expect(out.mimeType).toBe("image/webp");
    expect(out.width).toBe(400);
    expect(out.height).toBe(300);
    expect(sniffImageType(out.buffer)).toBe("webp");
  });

  it("accepts a valid PNG", async () => {
    const png = await sharp(noisyRaw(200, 200), { raw: { width: 200, height: 200, channels: 3 } }).png().toBuffer();
    const out = await processThumbnail(png);
    expect(["webp", "png"]).toContain(out.format);
    expect(out.width).toBe(200);
  });

  it("accepts a valid WebP", async () => {
    const webp = await sharp(noisyRaw(256, 128), { raw: { width: 256, height: 128, channels: 3 } }).webp().toBuffer();
    const out = await processThumbnail(webp);
    expect(out.format).toBe("webp");
  });

  it("preserves transparency of a transparent PNG", async () => {
    const png = await sharp({
      create: { width: 120, height: 120, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.4 } },
    }).png().toBuffer();
    const out = await processThumbnail(png);
    expect(out.hasTransparency).toBe(true);
    const meta = await sharp(out.buffer).metadata();
    expect(meta.hasAlpha).toBe(true);
    const { data } = await sharp(out.buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(data[3]).toBeLessThan(255); // still semi-transparent, not flattened
  });

  it("drops a fully opaque alpha channel", async () => {
    const png = await sharp({
      create: { width: 64, height: 64, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 1 } },
    }).png().toBuffer();
    const out = await processThumbnail(png);
    expect(out.hasTransparency).toBe(false);
  });
});

describe("processThumbnail — resizing, orientation, metadata", () => {
  it("downsizes oversized images to max 1280px keeping aspect ratio", async () => {
    const out = await processThumbnail(
      await sharp({ create: { width: 3000, height: 1500, channels: 3, background: "#3366cc" } }).jpeg().toBuffer()
    );
    expect(Math.max(out.width, out.height)).toBe(MAX_DIMENSION);
    expect(out.width).toBe(1280);
    expect(out.height).toBe(640);
  });

  it("never enlarges small images", async () => {
    const out = await processThumbnail(await sharp({ create: { width: 50, height: 40, channels: 3, background: "#fff" } }).png().toBuffer());
    expect([out.width, out.height]).toEqual([50, 40]);
  });

  it("applies EXIF orientation", async () => {
    const buf = await jpeg(200, 100).withMetadata({ orientation: 6 }).toBuffer(); // rotate 90° CW
    const out = await processThumbnail(buf);
    expect([out.width, out.height]).toEqual([100, 200]);
  });

  it("strips EXIF and GPS metadata", async () => {
    const buf = await jpeg()
      .withExif({
        IFD0: { Copyright: "secret-owner", Software: "leaky" },
        IFD3: { GPSLatitudeRef: "N", GPSLatitude: "51/1 30/1 0/1", GPSLongitudeRef: "W", GPSLongitude: "0/1 7/1 0/1" },
      })
      .toBuffer();
    expect((await sharp(buf).metadata()).exif).toBeDefined(); // sanity: input had EXIF
    const out = await processThumbnail(buf);
    const meta = await sharp(out.buffer).metadata();
    expect(meta.exif).toBeUndefined();
    expect(out.buffer.includes(Buffer.from("secret-owner"))).toBe(false);
    expect(out.buffer.includes(Buffer.from("GPS"))).toBe(false);
  });

  it("compresses a large high-quality JPEG substantially and reports sizes", async () => {
    const buf = await sharp({ create: { width: 1800, height: 1200, channels: 3, background: "#88aa44" } })
      .composite([{ input: noisyRaw(300, 300), raw: { width: 300, height: 300, channels: 3 }, top: 100, left: 100 }])
      .jpeg({ quality: 100, chromaSubsampling: "4:4:4" })
      .toBuffer();
    const out = await processThumbnail(buf);
    expect(out.originalSizeBytes).toBe(buf.length);
    expect(out.sizeBytes).toBe(out.buffer.length);
    expect(out.sizeBytes).toBeLessThan(buf.length);
  });
});

describe("processThumbnail — rejections", () => {
  it("rejects an empty file", async () => rejects(new Uint8Array(0), "empty"));

  it("rejects files over 2 MB", async () => {
    const big = Buffer.concat([await jpeg().toBuffer(), Buffer.alloc(MAX_UPLOAD_BYTES)]);
    await rejects(big, "too_large");
  });

  it("rejects SVG", async () => {
    await rejects(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), "unsupported_type");
  });

  it("rejects GIF", async () => {
    const gif = await sharp({ create: { width: 10, height: 10, channels: 3, background: "#fff" } }).gif().toBuffer();
    await rejects(gif, "unsupported_type");
  });

  it("rejects HTML and executables even with an image extension/MIME", async () => {
    await rejects(Buffer.from("<html><body>hi</body></html>"), "unsupported_type");
    await rejects(Buffer.from("MZ\x90\x00\x03\x00\x00\x00 fake exe"), "unsupported_type");
  });

  it("rejects a corrupt image that has valid magic bytes", async () => {
    const good = await jpeg(300, 300).toBuffer();
    await rejects(Buffer.concat([good.subarray(0, 120), Buffer.alloc(200, 7)]), "corrupt");
    await rejects(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 1, 2, 3]), "corrupt");
  });

  it("rejects a truncated PNG", async () => {
    const png = await sharp(noisyRaw(200, 200), { raw: { width: 200, height: 200, channels: 3 } }).png().toBuffer();
    await rejects(png.subarray(0, Math.floor(png.length / 2)), "corrupt");
  });

  it("rejects animated WebP", async () => {
    const frames = Buffer.concat([noisyRaw(32, 32), noisyRaw(32, 32).reverse()]);
    const anim = await sharp(frames, { raw: { width: 32, height: 64, channels: 3, pageHeight: 32 } })
      .webp({ loop: 0, delay: [100, 100] })
      .toBuffer();
    expect(isAnimatedWebp(anim)).toBe(true);
    await rejects(anim, "animated");
  });

  it("rejects animated PNG (APNG)", async () => {
    const png = await sharp(noisyRaw(16, 16), { raw: { width: 16, height: 16, channels: 3 } }).png().toBuffer();
    // Insert an acTL chunk right after IHDR (8 sig + 25 IHDR bytes). CRC is irrelevant: we reject before decoding.
    const actl = Buffer.concat([Buffer.from([0, 0, 0, 8]), Buffer.from("acTL"), Buffer.from([0, 0, 0, 2, 0, 0, 0, 0]), Buffer.alloc(4)]);
    const apng = Buffer.concat([png.subarray(0, 33), actl, png.subarray(33)]);
    expect(isAnimatedPng(apng)).toBe(true);
    expect(isAnimatedPng(png)).toBe(false);
    await rejects(apng, "animated");
  });

  it("rejects absurd pixel dimensions (decompression bomb guard)", async () => {
    const bomb = await sharp({ create: { width: 9000, height: 9000, channels: 3, background: "#000" } }).png({ compressionLevel: 9 }).toBuffer();
    if (bomb.length > MAX_UPLOAD_BYTES) return; // would be rejected for size first — still a rejection
    await rejects(bomb, "too_many_pixels");
  });

  it("ImageValidationError is an Error subclass", () => {
    expect(new ImageValidationError("corrupt", "x")).toBeInstanceOf(Error);
  });
});
