import { describe, expect, it } from "vitest";
import zlib from "zlib";
import sharp from "sharp";
import { ImageValidationError, isAnimatedPng, processThumbnail } from "../imageProcessing";

const noisy = (w: number, h: number, channels: 3 | 4 = 3) => {
  const data = Buffer.alloc(w * h * channels);
  for (let i = 0; i < data.length; i++) data[i] = (i * 37 + ((i / 7) | 0) * 91 + (i % 251)) & 255;
  return sharp(data, { raw: { width: w, height: h, channels } });
};

async function expectReject(buf: Buffer, reason: string, declaredMime?: string) {
  await expect(processThumbnail(buf, { declaredMime })).rejects.toMatchObject({ name: "ImageValidationError", reason });
}

/** Inserts an `acTL` (animation control) chunk to turn a PNG into an APNG-signature file. */
function makeApng(png: Buffer): Buffer {
  const type = Buffer.from("acTL");
  const data = Buffer.alloc(8);
  data.writeUInt32BE(2, 0);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(8);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([type, data])));
  const chunk = Buffer.concat([len, type, data, crc]);
  return Buffer.concat([png.subarray(0, 33), chunk, png.subarray(33)]); // after IHDR (8 sig + 25 IHDR)
}

describe("processThumbnail — accepted formats", () => {
  it("processes JPEG → WebP, resizes to <=1280 and compresses", async () => {
    const input = await noisy(60, 40).resize(3000, 2000).jpeg({ quality: 90 }).toBuffer();
    expect(input.length).toBeLessThan(2 * 1024 * 1024);
    const out = await processThumbnail(input, { declaredMime: "image/jpeg" });
    expect(out.mimeType).toBe("image/webp");
    expect(Math.max(out.width, out.height)).toBe(1280);
    expect(out.width).toBe(1280);
    expect(out.height).toBe(853);
    expect(out.buffer.length).toBeLessThan(input.length);
    expect(out.checksum).toMatch(/^[a-f0-9]{64}$/);
    const meta = await sharp(out.buffer).metadata();
    expect(meta.format).toBe("webp");
  });

  it("processes PNG and keeps transparency", async () => {
    const raw = Buffer.alloc(100 * 100 * 4, 0);
    for (let y = 0; y < 100; y++) for (let x = 0; x < 100; x++) {
      const o = (y * 100 + x) * 4;
      const inside = x > 25 && x < 75 && y > 25 && y < 75;
      raw[o] = 255; raw[o + 1] = 0; raw[o + 2] = 0; raw[o + 3] = inside ? 255 : 0;
    }
    const png = await sharp(raw, { raw: { width: 100, height: 100, channels: 4 } }).png().toBuffer();
    const out = await processThumbnail(png, { declaredMime: "image/png" });
    const meta = await sharp(out.buffer).metadata();
    expect(meta.hasAlpha).toBe(true);
    const { data, info } = await sharp(out.buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(data[3]).toBe(0); // top-left corner stays transparent
    const centre = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * 4;
    expect(data[centre + 3]).toBe(255);
  });

  it("processes WebP input", async () => {
    const input = await noisy(640, 480).webp({ quality: 90 }).toBuffer();
    const out = await processThumbnail(input, { declaredMime: "image/webp" });
    expect(out.width).toBe(640);
    expect(out.height).toBe(480);
  });

  it("uses lossless/optimised encoding for flat graphics and never grows a clean input", async () => {
    const logo = await sharp({ create: { width: 400, height: 200, channels: 3, background: { r: 10, g: 80, b: 200 } } }).png().toBuffer();
    const out = await processThumbnail(logo, { declaredMime: "image/png" });
    expect(["lossless_webp", "optimized_png", "kept_original"]).toContain(out.strategy);
    expect(out.buffer.length).toBeLessThanOrEqual(logo.length);
  });

  it("keeps an already-small clean image instead of recompressing when conversion would not help", async () => {
    const tiny = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#fff" } }).webp({ lossless: true }).toBuffer();
    const out = await processThumbnail(tiny, { declaredMime: "image/webp" });
    expect(out.buffer.length).toBeLessThanOrEqual(tiny.length);
  });
});

describe("processThumbnail — privacy and orientation", () => {
  it("strips EXIF including GPS", async () => {
    const withExif = await noisy(300, 200)
      .jpeg()
      .withExif({ IFD0: { Copyright: "secret" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "10/1 0/1 0/1", GPSLongitudeRef: "E", GPSLongitude: "20/1 0/1 0/1" } })
      .toBuffer();
    expect((await sharp(withExif).metadata()).exif).toBeDefined();
    const out = await processThumbnail(withExif, { declaredMime: "image/jpeg" });
    const meta = await sharp(out.buffer).metadata();
    expect(meta.exif).toBeUndefined();
    expect(out.buffer.includes(Buffer.from("secret"))).toBe(false);
  });

  it("applies EXIF orientation before stripping it", async () => {
    const rotated = await noisy(200, 100).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    expect((await sharp(rotated).metadata()).orientation).toBe(6);
    const out = await processThumbnail(rotated, { declaredMime: "image/jpeg" });
    expect(out.width).toBe(100);
    expect(out.height).toBe(200);
    expect((await sharp(out.buffer).metadata()).orientation ?? 1).toBe(1);
  });
});

describe("processThumbnail — rejection", () => {
  it("rejects SVG, HTML, executables and GIF by signature", async () => {
    await expectReject(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), "unsupported_format", "image/svg+xml");
    await expectReject(Buffer.from("<html><body>hi</body></html>"), "unsupported_format", "text/html");
    await expectReject(Buffer.concat([Buffer.from("MZ"), Buffer.alloc(200, 1)]), "unsupported_format", "image/png");
    await expectReject(Buffer.from("GIF89a\x01\x00\x01\x00\x00\x00\x00;", "binary"), "unsupported_format", "image/gif");
  });

  it("rejects a MIME type that does not match the content", async () => {
    const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: "#f00" } }).png().toBuffer();
    await expectReject(png, "mime_mismatch", "image/jpeg");
    await expectReject(png, "mime_mismatch", "text/plain");
  });

  it("rejects oversized and empty uploads", async () => {
    const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(2 * 1024 * 1024)]);
    await expectReject(big, "too_large", "image/jpeg");
    await expectReject(Buffer.alloc(0), "empty");
  });

  it("rejects corrupt/truncated images", async () => {
    const jpg = await noisy(400, 300).jpeg().toBuffer();
    await expectReject(jpg.subarray(0, Math.floor(jpg.length / 3)), "corrupt", "image/jpeg");
    await expectReject(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(64, 7)]), "corrupt", "image/jpeg");
  });

  it("rejects animated PNG (APNG)", async () => {
    const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: "#0f0" } }).png().toBuffer();
    const apng = makeApng(png);
    expect(isAnimatedPng(apng)).toBe(true);
    expect(isAnimatedPng(png)).toBe(false);
    await expectReject(apng, "animated", "image/png");
  });

  it("rejects animated WebP", async () => {
    const frameH = 20;
    const frames = Buffer.concat([Buffer.alloc(20 * frameH * 3, 255), Buffer.alloc(20 * frameH * 3, 0)]);
    const animated = await sharp(frames, { raw: { width: 20, height: frameH * 2, channels: 3, pageHeight: frameH } as never })
      .webp({ loop: 0, delay: [100, 100] })
      .toBuffer();
    const meta = await sharp(animated, { animated: true }).metadata();
    expect(meta.pages).toBe(2);
    await expectReject(animated, "animated", "image/webp");
  });

  it("exports a validation error type", () => {
    expect(new ImageValidationError("corrupt", "x")).toBeInstanceOf(Error);
  });
});
