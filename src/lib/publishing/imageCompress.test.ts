import { describe, expect, it, vi } from "vitest";
import {
  CLIENT_UPLOAD_LIMIT_BYTES,
  COMPRESSION_LADDER,
  ImageTooLargeError,
  SKIP_BELOW_BYTES,
  fitWithinLimit,
} from "./imageCompress";
import { THUMBNAIL_MAX_BYTES } from "@/lib/thumbnails/limits";

const MIB = 1024 * 1024;
const fileOf = (size: number, name = "pic.png", type = "image/png") => new File([new Uint8Array(size)], name, { type });
const blobOf = (size: number, type = "image/webp") => new Blob([new Uint8Array(size)], { type });

describe("thumbnail limit constant", () => {
  it("is 2 MiB and shared by the client compressor", () => {
    expect(THUMBNAIL_MAX_BYTES).toBe(2_097_152);
    expect(CLIENT_UPLOAD_LIMIT_BYTES).toBe(THUMBNAIL_MAX_BYTES);
  });
});

describe("fitWithinLimit (client-side compression guarantee)", () => {
  it("returns a small file untouched, without encoding", async () => {
    const encode = vi.fn();
    const f = fileOf(SKIP_BELOW_BYTES - 1);
    expect(await fitWithinLimit(f, encode)).toBe(f);
    expect(encode).not.toHaveBeenCalled();
  });

  it("keeps a file of exactly 2 MiB when nothing smaller can be produced", async () => {
    const f = fileOf(2 * MIB);
    const out = await fitWithinLimit(f, async () => null);
    expect(out).toBe(f);
    expect(out.size).toBe(THUMBNAIL_MAX_BYTES);
  });

  it("re-encodes an over-limit image and never returns more than 2 MiB", async () => {
    const f = fileOf(3 * MIB);
    const encode = vi.fn(async (_edge: number, q: number) => blobOf(q > 0.8 ? 2.5 * MIB : 1.2 * MIB));
    const out = await fitWithinLimit(f, encode);
    expect(out.size).toBeLessThanOrEqual(THUMBNAIL_MAX_BYTES);
    expect(out.type).toBe("image/webp");
    expect(out.name).toBe("pic.webp");
    expect(encode.mock.calls.length).toBeGreaterThan(1); // progressively tried harder settings
  });

  it("throws a helpful ImageTooLargeError when no attempt fits", async () => {
    const f = fileOf(5 * MIB);
    const encode = vi.fn(async () => blobOf(3 * MIB));
    await expect(fitWithinLimit(f, encode)).rejects.toBeInstanceOf(ImageTooLargeError);
    await expect(fitWithinLimit(f, encode)).rejects.toThrow(/2 MB/);
    expect(encode).toHaveBeenCalledTimes(COMPRESSION_LADDER.length * 2);
  });

  it("throws when the browser cannot decode the image and the original is too big", async () => {
    await expect(fitWithinLimit(fileOf(2 * MIB + 1), null)).rejects.toBeInstanceOf(ImageTooLargeError);
  });

  it("survives an encoder that throws", async () => {
    const f = fileOf(1.5 * MIB);
    const out = await fitWithinLimit(f, async () => {
      throw new Error("boom");
    });
    expect(out).toBe(f); // original fits in 2 MiB
  });
});
