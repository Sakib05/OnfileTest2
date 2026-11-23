import { describe, expect, it } from "vitest";
import { fixture } from "@/test/avatarFixtures";
import { processThumbnail } from "@/lib/thumbnails/imageProcessing";
import { StorageError } from "@/lib/thumbnails/provider";
import { uploadProfileImage, type AvatarDeps } from "./avatarService";

/** REAL server-side validation + sharp re-encoding; only storage and the DB are in-memory fakes. */
function pipeline(opts: { key?: string | null; putError?: StorageError } = {}) {
  const state = { key: opts.key ?? (null as string | null) };
  const stored = new Map<string, { size: number; mime: string }>();
  const deleted: string[] = [];
  const deps: AvatarDeps = {
    avatars: { getKey: async () => state.key, setKey: async (_id, k) => void (state.key = k) },
    repo: { addOrphan: async () => {}, getUploadGate: async () => ({ allowed: true, level: "ok" as never }), recordFailure: async () => {} },
    storage: {
      provider: "fake",
      put: async (key, body, mime) => {
        if (opts.putError) throw opts.putError;
        stored.set(key, { size: body.length, mime });
        return { key };
      },
      delete: async (key) => void (stored.delete(key), deleted.push(key)),
    },
    process: processThumbnail,
    urlFor: (k) => `https://cdn.example/${k}`,
  };
  return { deps, state, stored, deleted };
}

const up = (bytes: Buffer, p = pipeline()) => uploadProfileImage({ userId: 7, bytes: new Uint8Array(bytes) }, p.deps).then((r) => ({ r, p }));

describe("server accepts every supported, valid image", () => {
  it.each([
    ["JPEG", "landscape-1200x800.jpg"],
    ["PNG", "portrait-800x1200.png"],
    ["WebP", "square-1000.webp"],
    ["EXIF-rotated JPEG", "exif-rotated-600x400.jpg"],
  ])("%s", async (_n, file) => {
    const { r, p } = await up(fixture(file));
    expect(r.ok).toBe(true);
    expect(p.state.key).toMatch(/^avatar-7-[0-9a-f]{16}\.(webp|jpg|png)$/);
    expect(p.stored.size).toBe(1);
  });

  it("accepts the cropper's own 512×512 WebP and JPEG exports and stores a valid image", async () => {
    for (const f of ["avatar-512.webp", "avatar-512.jpg"]) {
      const { r, p } = await up(fixture(f));
      expect(r.ok).toBe(true);
      const [obj] = Array.from(p.stored.values());
      expect(["image/webp", "image/jpeg"]).toContain(obj.mime);
    }
  });
});

describe("server rejects bad input with the RIGHT code — and never touches the saved picture", () => {
  const cases: Array<[string, Buffer, number, string]> = [
    ["unsupported format (HEIC)", fixture("fake-photo.heic"), 415, "unsupported_type"],
    ["unsupported format (GIF)", fixture("fake.gif"), 415, "unsupported_type"],
    ["not an image at all", fixture("not-an-image.jpg"), 415, "unsupported_type"],
    ["empty image", fixture("empty.jpg"), 400, "empty"],
    ["corrupt (truncated) JPEG", fixture("corrupt-truncated.jpg"), 400, "corrupt"],
    ["malformed blob (JPEG header + noise)", Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("garbage".repeat(50))]), 400, "corrupt"],
    ["oversized image (> 2 MB)", Buffer.concat([fixture("landscape-1200x800.jpg"), Buffer.alloc(2 * 1024 * 1024)]), 413, "too_large"],
  ];
  it.each(cases)("%s", async (_n, bytes, status, code) => {
    const p = pipeline({ key: "avatar-7-old.webp" });
    const { r } = await up(bytes, p);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(status);
      expect(r.code).toBe(code);
    }
    expect(p.state.key).toBe("avatar-7-old.webp"); // reference unchanged
    expect(p.stored.size).toBe(0);
    expect(p.deleted).toEqual([]); // previous object NOT deleted
  });
});

describe("storage provider failure is reported as a storage problem, not a corrupt image", () => {
  it("keeps the previous picture and key", async () => {
    const p = pipeline({ key: "avatar-7-old.webp", putError: new StorageError("unknown", "boom") });
    const { r } = await up(fixture("avatar-512.webp"), p);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("storage_error");
      expect(r.status).toBe(502);
      expect(r.message).not.toMatch(/corrupt/i);
    }
    expect(p.state.key).toBe("avatar-7-old.webp");
    expect(p.deleted).toEqual([]);
  });
  it("replacing deletes the old object only after the new one is stored and committed", async () => {
    const p = pipeline({ key: "avatar-7-old.webp" });
    const { r } = await up(fixture("avatar-512.jpg"), p);
    expect(r.ok).toBe(true);
    expect(p.state.key).not.toBe("avatar-7-old.webp");
    expect(p.deleted).toEqual(["avatar-7-old.webp"]);
  });
});
