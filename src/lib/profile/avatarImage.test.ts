// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixture, fixtureFile } from "@/test/avatarFixtures";
import { AvatarError } from "./avatarErrors";
import { cropRect, initialCrop, zoomAt } from "./cropMath";
import { exportCrop, loadCropImage, validateAvatarBlob, WORK_MAX_EDGE, type CropImage } from "./avatarImage";

// ---- minimal browser fakes (jsdom has no decoder / canvas) -------------------------------------------------------
const behavior = { img: "ok" as "ok" | "error", size: { w: 1200, h: 800 }, bitmap: "ok" as "ok" | "error" };
class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 0;
  naturalHeight = 0;
  private _src = "";
  get src() { return this._src; }
  set src(v: string) {
    this._src = v;
    if (!v) return;
    queueMicrotask(() => {
      if (behavior.img === "ok") {
        this.naturalWidth = behavior.size.w;
        this.naturalHeight = behavior.size.h;
        this.onload?.();
      } else this.onerror?.();
    });
  }
}

const ctx = { fillStyle: "", fillRect: vi.fn(), drawImage: vi.fn(), imageSmoothingEnabled: false, imageSmoothingQuality: "low" };
let blobFor: (type: string) => Blob | null;
const bitmapClose = vi.fn();

beforeEach(() => {
  behavior.img = "ok";
  behavior.bitmap = "ok";
  behavior.size = { w: 1200, h: 800 };
  ctx.fillRect.mockClear();
  ctx.drawImage.mockClear();
  bitmapClose.mockClear();
  vi.stubGlobal("Image", FakeImage);
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => {
      if (behavior.bitmap === "error") throw new Error("bitmap_failed");
      return { width: behavior.size.w, height: behavior.size.h, close: bitmapClose };
    })
  );
  URL.createObjectURL = vi.fn(() => "blob:test/1");
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => ctx) as never);
  HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback, type?: string) {
    cb(blobFor(type ?? "image/png"));
  };
  blobFor = (type) => new Blob([new Uint8Array(fixture(type === "image/jpeg" ? "avatar-512.jpg" : "avatar-512.webp"))], { type });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const kindOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return "resolved";
  } catch (e) {
    return e instanceof AvatarError ? e.kind : `other:${String(e)}`;
  }
};

describe("loadCropImage — accurate rejection (never a blanket 'corrupt')", () => {
  it("empty file", async () => expect(await kindOf(loadCropImage(fixtureFile("empty.jpg", "image/jpeg")))).toBe("empty"));
  it("HEIC/HEIF is recognised and explained", async () => {
    expect(await kindOf(loadCropImage(fixtureFile("fake-photo.heic", "image/heic")))).toBe("heic_unsupported");
    // Android may report no / a wrong MIME type — the bytes still decide.
    expect(await kindOf(loadCropImage(fixtureFile("fake-photo.heic", "")))).toBe("heic_unsupported");
    expect(await kindOf(loadCropImage(fixtureFile("fake-photo.heic", "image/jpeg")))).toBe("heic_unsupported");
  });
  it("GIF is an unsupported format", async () => {
    expect(await kindOf(loadCropImage(fixtureFile("fake.gif", "image/gif")))).toBe("unsupported_format");
  });
  it("text that claims to be a JPEG is corrupt; text with no image type is unsupported", async () => {
    expect(await kindOf(loadCropImage(fixtureFile("not-an-image.jpg", "image/jpeg")))).toBe("corrupt");
    expect(await kindOf(loadCropImage(fixtureFile("not-an-image.jpg", "")))).toBe("unsupported_format");
  });
  it("a file over 20 MB is too large (before reading it)", async () => {
    const f = fixtureFile("landscape-1200x800.jpg", "image/jpeg");
    Object.defineProperty(f, "size", { value: 21 * 1024 * 1024 });
    expect(await kindOf(loadCropImage(f))).toBe("too_large");
  });
  it("absurd pixel dimensions are rejected from the header, without decoding", async () => {
    const bytes = new Uint8Array(fixture("portrait-800x1200.png"));
    new DataView(bytes.buffer).setUint32(16, 20000);
    new DataView(bytes.buffer).setUint32(20, 20000);
    expect(await kindOf(loadCropImage(new File([bytes], "huge.png", { type: "image/png" })))).toBe("too_large");
    expect(globalThis.createImageBitmap).not.toHaveBeenCalled();
  });
  it("a file the OS won't hand over is 'unreadable'", async () => {
    const f = fixtureFile("landscape-1200x800.jpg", "image/jpeg");
    f.arrayBuffer = () => Promise.reject(new DOMException("denied", "NotReadableError"));
    expect(await kindOf(loadCropImage(f))).toBe("unreadable");
  });
  it("valid signature but every decoder fails → decode_failed (names each attempt for diagnostics)", async () => {
    behavior.img = "error";
    behavior.bitmap = "error";
    try {
      await loadCropImage(fixtureFile("landscape-1200x800.jpg", "image/jpeg"));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AvatarError);
      const err = e as AvatarError;
      expect(err.kind).toBe("decode_failed");
      expect(err.message).not.toMatch(/corrupt/i);
      expect(err.detail).toContain("img-blob-url");
      expect(err.detail).toContain("bitmap-from-image");
      expect(err.detail).toContain("img-data-url");
    }
  });
});

describe("loadCropImage — decoding", () => {
  it.each([
    ["JPEG", "landscape-1200x800.jpg", "image/jpeg"],
    ["PNG", "portrait-800x1200.png", "image/png"],
    ["WebP", "square-1000.webp", "image/webp"],
    ["JPEG with a missing MIME type (Android picker)", "landscape-1200x800.jpg", ""],
  ])("%s opens", async (_n, name, type) => {
    const img = await loadCropImage(fixtureFile(name, type));
    expect(["jpeg", "png", "webp"]).toContain(img.format);
    expect(img.width).toBe(1200);
    expect(img.canvas.width).toBe(1200);
    img.release();
    expect(img.canvas.width).toBe(0);
  });

  it("falls back to the next decoder when <img> fails (older Android WebView)", async () => {
    behavior.img = "error";
    const img = await loadCropImage(fixtureFile("landscape-1200x800.jpg", "image/jpeg"));
    expect(img.decoder).toBe("bitmap-from-image");
  });

  it("falls back to the FileReader data-URL path as a last resort", async () => {
    let n = 0;
    const orig = Object.getOwnPropertyDescriptor(FakeImage.prototype, "src")!;
    Object.defineProperty(FakeImage.prototype, "src", {
      configurable: true,
      get: orig.get,
      set(this: FakeImage, v: string) {
        // Fail only the blob: URL attempt; accept the data: URL.
        if (v.startsWith("blob:")) { n++; behavior.img = "error"; } else behavior.img = "ok";
        orig.set!.call(this, v);
      },
    });
    behavior.bitmap = "error";
    const img = await loadCropImage(fixtureFile("landscape-1200x800.jpg", "image/jpeg"));
    expect(img.decoder).toBe("img-data-url");
    expect(n).toBe(1);
    Object.defineProperty(FakeImage.prototype, "src", orig);
  });

  it("downsizes huge photos into a bounded working canvas and frees the full-size bitmap", async () => {
    behavior.img = "error"; // force the bitmap path so we can observe close()
    behavior.size = { w: 4000, h: 3000 };
    const img = await loadCropImage(fixtureFile("landscape-1200x800.jpg", "image/jpeg"));
    expect(Math.max(img.width, img.height)).toBe(WORK_MAX_EDGE);
    expect(img.width / img.height).toBeCloseTo(4 / 3, 2);
    expect(img.originalWidth).toBe(4000);
    expect(bitmapClose).toHaveBeenCalled();
  });

  it("revokes the object URL after decoding (no leak)", async () => {
    await loadCropImage(fixtureFile("landscape-1200x800.jpg", "image/jpeg"));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test/1");
  });
});

describe("exportCrop", () => {
  const workImage = (w: number, h: number): CropImage => {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    return { canvas, width: w, height: h, originalWidth: w, originalHeight: h, format: "jpeg", decoder: "test", release() {} };
  };

  it("draws exactly the chosen square into a ≤512 square and returns a valid WebP file", async () => {
    const img = workImage(2000, 1500);
    const rect = cropRect(zoomAt(initialCrop(), 2, 0, 0, 2000, 1500), 2000, 1500);
    const file = await exportCrop(img, rect);
    expect(file.type).toBe("image/webp");
    expect(file.name).toBe("avatar.webp");
    expect(file.size).toBeGreaterThan(0);
    const call = ctx.drawImage.mock.calls.at(-1)!;
    expect(call.slice(1, 5)).toEqual([rect.sx, rect.sy, rect.side, rect.side]); // the chosen source region
    expect(call[7]).toBe(call[8]); // square destination
    expect(call[7]).toBe(512); // capped at 512 even though the crop is 750 px
  });

  it("never enlarges a small crop beyond its own resolution", async () => {
    const img = workImage(300, 200);
    const file = await exportCrop(img, cropRect(initialCrop(), 300, 200));
    expect(file.type).toBe("image/webp");
    expect(ctx.drawImage.mock.calls.at(-1)![7]).toBe(200);
  });

  it("falls back to JPEG when the browser can't encode WebP (it silently returns PNG)", async () => {
    blobFor = (type) =>
      type === "image/webp"
        ? new Blob([new Uint8Array(fixture("portrait-800x1200.png"))], { type: "image/png" })
        : new Blob([new Uint8Array(fixture("avatar-512.jpg"))], { type });
    const file = await exportCrop(workImage(1000, 1000), cropRect(initialCrop(), 1000, 1000));
    expect(file.type).toBe("image/jpeg");
    expect(file.name).toBe("avatar.jpg");
  });

  it("fails with processing_failed (not 'corrupt') when no valid blob can be produced", async () => {
    for (const mk of [() => null, () => new Blob([], { type: "image/webp" }), () => new Blob(["junk-bytes"], { type: "image/webp" })]) {
      blobFor = mk;
      expect(await kindOf(exportCrop(workImage(1000, 1000), cropRect(initialCrop(), 1000, 1000)))).toBe("processing_failed");
    }
  });
});

describe("validateAvatarBlob", () => {
  const blob = (name: string, type: string) => new Blob([new Uint8Array(fixture(name))], { type });
  it("accepts real 512 px WebP and JPEG", async () => {
    expect(await validateAvatarBlob(blob("avatar-512.webp", "image/webp"))).toBe("webp");
    expect(await validateAvatarBlob(blob("avatar-512.jpg", "image/jpeg"))).toBe("jpeg");
  });
  it("rejects empty, text, PNG, mislabelled and oversize-geometry blobs", async () => {
    expect(await kindOf(validateAvatarBlob(new Blob([])))).toBe("processing_failed");
    expect(await kindOf(validateAvatarBlob(blob("not-an-image.jpg", "image/jpeg")))).toBe("processing_failed");
    expect(await kindOf(validateAvatarBlob(blob("portrait-800x1200.png", "image/png")))).toBe("processing_failed");
    expect(await kindOf(validateAvatarBlob(blob("avatar-512.jpg", "image/webp")))).toBe("processing_failed"); // MIME ≠ bytes
    expect(await kindOf(validateAvatarBlob(blob("square-1000.webp", "image/webp")))).toBe("processing_failed"); // > 512 px
  });
  it("rejects a blob over the server's 2 MB limit as too_large", async () => {
    const big = new Blob([new Uint8Array(fixture("avatar-512.jpg")), new Uint8Array(2 * 1024 * 1024)], { type: "image/jpeg" });
    expect(await kindOf(validateAvatarBlob(big))).toBe("too_large");
  });
});
