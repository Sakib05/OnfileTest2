import { describe, expect, it, vi } from "vitest";
import { buildAvatarObjectKey, removeProfileImage, uploadProfileImage, type AvatarDeps } from "./avatarService";
import { ImageValidationError, type ProcessedThumbnail } from "@/lib/thumbnails/imageProcessing";
import { StorageError } from "@/lib/thumbnails/provider";

function makeDeps(opts: { key?: string | null; putError?: StorageError; processError?: Error; dbError?: boolean; deleteError?: boolean; noStorage?: boolean } = {}) {
  const state = { key: opts.key ?? null as string | null };
  const stored = new Map<string, number>();
  const orphans: string[] = [];
  const deps: AvatarDeps = {
    avatars: {
      getKey: async () => state.key,
      setKey: async (_id, k) => {
        if (opts.dbError && k !== null) throw new Error("db down");
        state.key = k;
      },
    },
    repo: {
      addOrphan: async (key) => void orphans.push(key),
      getUploadGate: async () => ({ allowed: true, level: "ok" as never }),
      recordFailure: async () => {},
    },
    storage: opts.noStorage
      ? null
      : {
          provider: "fake",
          put: async (key, body) => {
            if (opts.putError) throw opts.putError;
            stored.set(key, body.length);
            return { key };
          },
          delete: async (key) => {
            if (opts.deleteError) throw new Error("delete failed");
            stored.delete(key);
          },
        },
    process: async () => {
      if (opts.processError) throw opts.processError;
      return { buffer: Buffer.from("img"), mimeType: "image/webp", format: "webp", extension: "webp", width: 512, height: 512, sizeBytes: 3, originalSizeBytes: 9, hasTransparency: false, strategy: "t" } as ProcessedThumbnail;
    },
    urlFor: (k) => `https://cdn.example/${k}`,
  };
  return { deps, state, stored, orphans };
}

const bytes = new Uint8Array([1, 2, 3]);

describe("buildAvatarObjectKey", () => {
  it("is flat, unique per call, and names the owner", () => {
    const a = buildAvatarObjectKey(7, "webp");
    const b = buildAvatarObjectKey(7, "webp");
    expect(a).toMatch(/^avatar-7-[0-9a-f]{16}\.webp$/);
    expect(a).not.toBe(b);
    expect(a).not.toContain("/");
  });
});

describe("uploadProfileImage", () => {
  it("stores the optimised image and commits the new key", async () => {
    const { deps, state, stored } = makeDeps();
    const r = await uploadProfileImage({ userId: 7, bytes }, deps);
    expect(r.ok).toBe(true);
    expect(state.key).toMatch(/^avatar-7-/);
    expect(stored.has(state.key!)).toBe(true);
    if (r.ok) expect(r.url).toBe(`https://cdn.example/${state.key}`);
  });

  it("replacing deletes the OLD object only after the new key is committed", async () => {
    const { deps, state, stored } = makeDeps({ key: "avatar-7-old.webp" });
    stored.set("avatar-7-old.webp", 1);
    const r = await uploadProfileImage({ userId: 7, bytes }, deps);
    expect(r.ok).toBe(true);
    expect(state.key).not.toBe("avatar-7-old.webp");
    expect(stored.has("avatar-7-old.webp")).toBe(false);
    expect(stored.size).toBe(1);
  });

  it("a failed old-object delete goes to the orphan queue and still succeeds", async () => {
    const { deps, orphans } = makeDeps({ key: "avatar-7-old.webp", deleteError: true });
    const r = await uploadProfileImage({ userId: 7, bytes }, deps);
    expect(r.ok).toBe(true);
    expect(orphans).toEqual(["avatar-7-old.webp"]);
  });

  it("rejects invalid images with the right status and changes nothing", async () => {
    const { deps, state, stored } = makeDeps({ key: "avatar-7-old.webp", processError: new ImageValidationError("unsupported_type", "Only JPEG, PNG and WebP images are allowed.") });
    const r = await uploadProfileImage({ userId: 7, bytes }, deps);
    expect(r).toMatchObject({ ok: false, status: 415, code: "unsupported_type" });
    expect(state.key).toBe("avatar-7-old.webp");
    expect(stored.size).toBe(0);
  });

  it("maps oversize to 413", async () => {
    const { deps } = makeDeps({ processError: new ImageValidationError("too_large", "too big") });
    expect(await uploadProfileImage({ userId: 7, bytes }, deps)).toMatchObject({ ok: false, status: 413 });
  });

  it("storage failure keeps the previous picture", async () => {
    const { deps, state } = makeDeps({ key: "avatar-7-old.webp", putError: new StorageError("server", "boom") });
    const r = await uploadProfileImage({ userId: 7, bytes }, deps);
    expect(r).toMatchObject({ ok: false, status: 502 });
    expect(state.key).toBe("avatar-7-old.webp");
  });

  it("DB failure removes the just-stored object and keeps the previous picture", async () => {
    const { deps, state, stored } = makeDeps({ key: "avatar-7-old.webp", dbError: true });
    const r = await uploadProfileImage({ userId: 7, bytes }, deps);
    expect(r).toMatchObject({ ok: false, status: 500, code: "db_write_failed" });
    expect(state.key).toBe("avatar-7-old.webp");
    expect(stored.size).toBe(0);
  });

  it("reports storage_unavailable when no provider is configured", async () => {
    const { deps } = makeDeps({ noStorage: true });
    expect(await uploadProfileImage({ userId: 7, bytes }, deps)).toMatchObject({ ok: false, status: 503, code: "storage_unavailable" });
  });

  it("does not block on a gate failure (fail open)", async () => {
    const { deps } = makeDeps();
    deps.repo.getUploadGate = async () => { throw new Error("usage table down"); };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await uploadProfileImage({ userId: 7, bytes }, deps)).ok).toBe(true);
    spy.mockRestore();
  });
});

describe("removeProfileImage", () => {
  it("clears the key (→ Telegram photo / initials) and deletes the object", async () => {
    const { deps, state, stored } = makeDeps({ key: "avatar-7-old.webp" });
    stored.set("avatar-7-old.webp", 1);
    expect(await removeProfileImage({ userId: 7 }, deps)).toEqual({ ok: true, removed: true });
    expect(state.key).toBeNull();
    expect(stored.size).toBe(0);
  });

  it("is idempotent when there is no custom picture", async () => {
    const { deps } = makeDeps();
    expect(await removeProfileImage({ userId: 7 }, deps)).toEqual({ ok: true, removed: false });
  });

  it("an object-delete failure is queued as an orphan but the removal still succeeds", async () => {
    const { deps, state, orphans } = makeDeps({ key: "avatar-7-old.webp", deleteError: true });
    expect(await removeProfileImage({ userId: 7 }, deps)).toEqual({ ok: true, removed: true });
    expect(state.key).toBeNull();
    expect(orphans).toEqual(["avatar-7-old.webp"]);
  });
});
