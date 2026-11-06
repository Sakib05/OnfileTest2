import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { buildObjectKey, removeThumbnail, uploadThumbnail, cleanupThumbnailObject, type ThumbnailDeps } from "./service";
import { StorageError, type ThumbnailStorage } from "./provider";
import { processThumbnail } from "./imageProcessing";
import type { CommitInput, ThumbnailRepo, UploadGate } from "./repo";

// ─── In-memory fakes (no network, no database) ───────────────────────────────
function makeWorld(opts: { gate?: UploadGate; putError?: StorageError; deleteError?: StorageError; commitError?: Error } = {}) {
  const objects = new Map<string, number>(); // key -> bytes (the fake "bucket")
  const thumbs = new Map<number, CommitInput>(); // fileId -> row
  const fileOwner = new Map<number, number>([[10, 1], [20, 2]]); // fileId -> userId
  const orphans: { key: string; reason: string }[] = [];
  const failures: { code: string }[] = [];
  const state = { putError: opts.putError, deleteError: opts.deleteError, commitError: opts.commitError };

  const storage: ThumbnailStorage = {
    provider: "dbbyte",
    async put(key, body) {
      if (state.putError) throw state.putError;
      objects.set(key, body.byteLength);
      return { key };
    },
    async delete(key) {
      if (state.deleteError) throw state.deleteError;
      objects.delete(key);
    },
  };
  const repo: ThumbnailRepo = {
    async findOwnedFile(userId, fileId) { return fileOwner.get(fileId) === userId; },
    async commitThumbnail(input) {
      if (state.commitError) throw state.commitError;
      const prev = thumbs.get(input.fileId)?.objectKey ?? null;
      thumbs.set(input.fileId, input);
      return { previousKey: prev };
    },
    async removeThumbnail(userId, fileId) {
      const row = thumbs.get(fileId);
      if (!row || row.userId !== userId) return null;
      thumbs.delete(fileId);
      return { objectKey: row.objectKey };
    },
    async getThumbnailKey(userId, fileId) {
      const r = thumbs.get(fileId);
      return r && r.userId === userId ? r.objectKey : null;
    },
    async addOrphan(key, reason) { orphans.push({ key, reason }); },
    async recordFailure(f) { failures.push({ code: f.code }); },
    async getUploadGate() { return opts.gate ?? { allowed: true, level: "ok" }; },
  };
  const deps: ThumbnailDeps = { repo, storage, process: processThumbnail, urlFor: (k) => `https://cdn.test/tok/bucket/${k}` };
  return { deps, objects, thumbs, orphans, failures, state };
}

const png = (color: string, w = 64, h = 64) => sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toBuffer();
const up = (deps: ThumbnailDeps, userId: number, fileId: number, bytes: Uint8Array) => uploadThumbnail({ userId, fileId, bytes }, deps);

describe("authorization & ownership", () => {
  it("allows the owner to upload", async () => {
    const w = makeWorld();
    const r = await up(w.deps, 1, 10, await png("#f00"));
    expect(r.ok).toBe(true);
    expect(w.thumbs.get(10)?.userId).toBe(1);
  });

  it("rejects uploading to another creator's file (404, nothing stored)", async () => {
    const w = makeWorld();
    const r = await up(w.deps, 1, 20, await png("#f00"));
    expect(r).toMatchObject({ ok: false, status: 404, code: "not_found" });
    expect(w.objects.size).toBe(0);
    expect(w.thumbs.size).toBe(0);
  });

  it("rejects uploading to a nonexistent file", async () => {
    const w = makeWorld();
    expect(await up(w.deps, 1, 999, await png("#f00"))).toMatchObject({ ok: false, status: 404 });
  });

  it("rejects deleting another creator's thumbnail and leaves it intact", async () => {
    const w = makeWorld();
    await up(w.deps, 2, 20, await png("#0f0"));
    const r = await removeThumbnail({ userId: 1, fileId: 20 }, w.deps);
    expect(r).toMatchObject({ ok: false, status: 404 });
    expect(w.thumbs.has(20)).toBe(true);
    expect(w.objects.size).toBe(1);
  });
});

describe("upload / replace / delete lifecycle", () => {
  it("object keys are flat, per-upload unique and embed the creator/file ids", async () => {
    expect(buildObjectKey(1, 10, "abc", "webp")).toBe("thumb-1-10-abc.webp");
    expect(buildObjectKey(1, 10, "abc", "webp")).not.toContain("/");
    const w = makeWorld();
    const a = await up(w.deps, 1, 10, await png("#f00"));
    const b = await up(w.deps, 1, 10, await png("#00f"));
    if (!a.ok || !b.ok) throw new Error("upload failed");
    expect(a.thumbnail.version).not.toBe(b.thumbnail.version);
    expect(a.thumbnail.url).not.toBe(b.thumbnail.url);
  });

  it("replacement: new URL is live, old object removed only AFTER commit", async () => {
    const w = makeWorld();
    const order: string[] = [];
    const origCommit = w.deps.repo.commitThumbnail;
    w.deps.repo.commitThumbnail = async (i) => { order.push("commit"); return origCommit(i); };
    const origDel = w.deps.storage!.delete;
    w.deps.storage!.delete = async (k) => { order.push("delete"); return origDel(k); };

    const a = await up(w.deps, 1, 10, await png("#f00"));
    const b = await up(w.deps, 1, 10, await png("#00f"));
    if (!a.ok || !b.ok) throw new Error("upload failed");
    expect(order).toEqual(["commit", "commit", "delete"]);
    expect(w.objects.size).toBe(1); // exactly one object left
    expect(w.thumbs.get(10)?.version).toBe(b.thumbnail.version);
    expect([...w.objects.keys()][0]).toBe(w.thumbs.get(10)?.objectKey);
  });

  it("failed cleanup of the OLD object after replace is queued, and the new thumbnail still works", async () => {
    const w = makeWorld();
    await up(w.deps, 1, 10, await png("#f00"));
    w.state.deleteError = new StorageError("server", "boom", { status: 500 });
    const b = await up(w.deps, 1, 10, await png("#00f"));
    expect(b.ok).toBe(true);
    expect(w.orphans).toHaveLength(1);
    expect(w.orphans[0].reason).toBe("replace_cleanup_failed");
  });

  it("delete removes DB reference and object", async () => {
    const w = makeWorld();
    await up(w.deps, 1, 10, await png("#f00"));
    const r = await removeThumbnail({ userId: 1, fileId: 10 }, w.deps);
    expect(r).toEqual({ ok: true, removed: true });
    expect(w.thumbs.size).toBe(0);
    expect(w.objects.size).toBe(0);
  });

  it("delete: DB reference is gone even if the DBByte delete fails; object is queued as orphan", async () => {
    const w = makeWorld();
    await up(w.deps, 1, 10, await png("#f00"));
    w.state.deleteError = new StorageError("network", "down");
    const r = await removeThumbnail({ userId: 1, fileId: 10 }, w.deps);
    expect(r).toEqual({ ok: true, removed: true });
    expect(w.thumbs.size).toBe(0); // UI can no longer point at it
    expect(w.orphans).toHaveLength(1);
  });

  it("delete is idempotent for a file without a thumbnail", async () => {
    const w = makeWorld();
    expect(await removeThumbnail({ userId: 1, fileId: 10 }, w.deps)).toEqual({ ok: true, removed: false });
  });

  it("file-deletion cleanup removes the object or queues it", async () => {
    const w = makeWorld();
    w.objects.set("k.webp", 1);
    await cleanupThumbnailObject("k.webp", w.deps);
    expect(w.objects.size).toBe(0);
    w.state.deleteError = new StorageError("server", "x");
    await cleanupThumbnailObject("k2.webp", w.deps);
    expect(w.orphans.map((o) => o.key)).toEqual(["k2.webp"]);
  });
});

describe("failure handling", () => {
  it("DB write failure after a successful upload: new object cleaned up, old thumbnail untouched", async () => {
    const w = makeWorld();
    const first = await up(w.deps, 1, 10, await png("#f00"));
    if (!first.ok) throw new Error("setup failed");
    const oldKey = w.thumbs.get(10)!.objectKey;
    w.state.commitError = new Error("db down");
    const r = await up(w.deps, 1, 10, await png("#00f"));
    expect(r).toMatchObject({ ok: false, code: "db_write_failed", status: 500 });
    expect(w.thumbs.get(10)!.objectKey).toBe(oldKey);
    expect([...w.objects.keys()]).toEqual([oldKey]); // orphan removed, old kept
    expect(w.failures.map((f) => f.code)).toContain("db_write_failed");
  });

  it("DB write failure AND cleanup failure: object is queued as an orphan", async () => {
    const w = makeWorld({ commitError: new Error("db down") });
    w.state.deleteError = new StorageError("server", "x");
    await up(w.deps, 1, 10, await png("#f00"));
    expect(w.orphans.map((o) => o.reason)).toEqual(["db_write_failed"]);
  });

  it("rate limit: 429 with Retry-After surfaces a clear message and retryAfter", async () => {
    const w = makeWorld({ putError: new StorageError("rate_limited", "slow", { status: 429, retryAfter: 45 }) });
    const r = await up(w.deps, 1, 10, await png("#f00"));
    expect(r).toMatchObject({ ok: false, status: 429, code: "rate_limited", retryAfter: 45 });
    expect(w.thumbs.size).toBe(0);
  });

  it("quota exceeded: graceful 503 uploads_paused and failure recorded", async () => {
    const w = makeWorld({ putError: new StorageError("quota_exceeded", "quota", { status: 429 }) });
    const r = await up(w.deps, 1, 10, await png("#f00"));
    expect(r).toMatchObject({ ok: false, status: 503, code: "uploads_paused" });
    expect(w.failures.map((f) => f.code)).toContain("quota_exceeded");
  });

  it("auth failure hides provider details from the creator", async () => {
    const w = makeWorld({ putError: new StorageError("auth", "Invalid API key dbk_xxx", { status: 401 }) });
    const r = await up(w.deps, 1, 10, await png("#f00"));
    expect(r).toMatchObject({ ok: false, status: 503, code: "storage_unavailable" });
    expect(JSON.stringify(r)).not.toContain("dbk_");
  });

  it("server error / timeout map to 502 and (for ambiguous ones) attempt cleanup", async () => {
    const w = makeWorld({ putError: new StorageError("timeout", "t") });
    const r = await up(w.deps, 1, 10, await png("#f00"));
    expect(r).toMatchObject({ ok: false, status: 502, code: "storage_error" });
    expect(w.thumbs.size).toBe(0);
  });

  it("uploads are refused (503) while the usage gate is closed; nothing is uploaded", async () => {
    const w = makeWorld({ gate: { allowed: false, level: "restricted", reason: "usage" } });
    const r = await up(w.deps, 1, 10, await png("#f00"));
    expect(r).toMatchObject({ ok: false, status: 503, code: "uploads_paused" });
    expect(w.objects.size).toBe(0);
  });

  it("deleting still works while uploads are paused", async () => {
    const w = makeWorld();
    await up(w.deps, 1, 10, await png("#f00"));
    w.deps.repo.getUploadGate = async () => ({ allowed: false, level: "full", reason: "usage" });
    expect(await removeThumbnail({ userId: 1, fileId: 10 }, w.deps)).toEqual({ ok: true, removed: true });
  });

  it("not configured: 503 storage_unavailable", async () => {
    const w = makeWorld();
    w.deps.storage = null;
    expect(await up(w.deps, 1, 10, await png("#f00"))).toMatchObject({ ok: false, status: 503, code: "storage_unavailable" });
  });

  it("invalid images map to 4xx and never touch storage", async () => {
    const w = makeWorld();
    const put = vi.spyOn(w.deps.storage!, "put");
    expect(await up(w.deps, 1, 10, Buffer.from("<svg/>"))).toMatchObject({ ok: false, status: 415, code: "unsupported_type" });
    expect(await up(w.deps, 1, 10, Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3]))).toMatchObject({ ok: false, status: 400, code: "corrupt" });
    expect(put).not.toHaveBeenCalled();
  });
});

describe("caching behaviour", () => {
  it("every stored object is immutable-by-name: replacing never reuses a URL", async () => {
    const w = makeWorld();
    const urls = new Set<string>();
    for (const c of ["#111", "#222", "#333"]) {
      const r = await up(w.deps, 1, 10, await png(c));
      if (r.ok) urls.add(r.thumbnail.url!);
    }
    expect(urls.size).toBe(3);
  });

  it("after delete the URL is no longer referenced by the app", async () => {
    const w = makeWorld();
    await up(w.deps, 1, 10, await png("#111"));
    await removeThumbnail({ userId: 1, fileId: 10 }, w.deps);
    expect(await w.deps.repo.getThumbnailKey(1, 10)).toBeNull();
  });
});
