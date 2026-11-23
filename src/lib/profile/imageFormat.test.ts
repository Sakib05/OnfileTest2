import { describe, expect, it } from "vitest";
import { fixture } from "@/test/avatarFixtures";
import { isSupportedFormat, readImageSize, sniffImageFormat } from "./imageFormat";

const u8 = (b: Buffer) => new Uint8Array(b);

describe("sniffImageFormat (real fixtures)", () => {
  it("detects JPEG, PNG and WebP from the bytes", () => {
    expect(sniffImageFormat(u8(fixture("landscape-1200x800.jpg")))).toBe("jpeg");
    expect(sniffImageFormat(u8(fixture("portrait-800x1200.png")))).toBe("png");
    expect(sniffImageFormat(u8(fixture("square-1000.webp")))).toBe("webp");
  });
  it("recognises HEIC and GIF so they can be reported accurately", () => {
    expect(sniffImageFormat(u8(fixture("fake-photo.heic")))).toBe("heic");
    expect(sniffImageFormat(u8(fixture("fake.gif")))).toBe("gif");
  });
  it("returns unknown for text, empty and tiny buffers", () => {
    expect(sniffImageFormat(u8(fixture("not-an-image.jpg")))).toBe("unknown");
    expect(sniffImageFormat(u8(fixture("empty.jpg")))).toBe("unknown");
    expect(sniffImageFormat(new Uint8Array([0xff, 0xd8]))).toBe("unknown");
  });
  it("only JPEG/PNG/WebP count as supported", () => {
    expect(["jpeg", "png", "webp"].every((f) => isSupportedFormat(f as never))).toBe(true);
    expect(["heic", "avif", "gif", "unknown"].some((f) => isSupportedFormat(f as never))).toBe(false);
  });
});

describe("readImageSize (header only, no decoding)", () => {
  it("reads JPEG / PNG / WebP dimensions", () => {
    expect(readImageSize(u8(fixture("landscape-1200x800.jpg")))).toEqual({ width: 1200, height: 800 });
    expect(readImageSize(u8(fixture("portrait-800x1200.png")))).toEqual({ width: 800, height: 1200 });
    expect(readImageSize(u8(fixture("square-1000.webp")))).toEqual({ width: 1000, height: 1000 });
    expect(readImageSize(u8(fixture("avatar-512.webp")))).toEqual({ width: 512, height: 512 });
    expect(readImageSize(u8(fixture("avatar-512.jpg")))).toEqual({ width: 512, height: 512 });
  });
  it("reads the stored (un-rotated) size of an EXIF-rotated JPEG", () => {
    expect(readImageSize(u8(fixture("exif-rotated-600x400.jpg")))).toEqual({ width: 600, height: 400 });
  });
  it("returns null for truncated headers and non-images", () => {
    expect(readImageSize(u8(fixture("not-an-image.jpg")))).toBeNull();
    expect(readImageSize(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0]))).toBeNull();
    expect(readImageSize(u8(fixture("portrait-800x1200.png")).subarray(0, 20))).toBeNull();
  });
});
