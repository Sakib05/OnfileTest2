import http from "http";
import type { AddressInfo } from "net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { files, fileThumbnails, storageUsageManual, thumbnailFailures, thumbnailOrphans, users } from "@/db/schema";
import { DbbyteStorage } from "./dbbyte";
import { processThumbnail } from "./imageProcessing";
import { drizzleRepo, getThumbnailsForFiles } from "./repo";
import { removeThumbnail, uploadThumbnail, type ThumbnailDeps } from "./service";

/**
 * Real Postgres (the DATABASE_URL project DB, same as the existing DB tests) +
 * the real DbbyteStorage talking HTTP to a LOCAL fake that mimics DBByte's
 * documented API shape. This is NOT a test against real DBByte.
 */
const bucket: Map<string, Buffer> = new Map();
let server: http.Server;
let base = "";
let savedUsage: (typeof storageUsageManual.$inferInsert)[] = [];
let userA = 0, userB = 0, fileA = 0, fileB = 0;
const tag = `it_${Date.now()}`;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url!, "http://x");
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", async () => {
      const body = Buffer.concat(chunks);
      res.setHeader("Content-Type", "application/json");
      if (req.headers.authorization !== "Bearer test-key") { res.statusCode = 401; return res.end('{"error":"bad key"}'); }
      const up = url.pathname.match(/^\/storage\/test-bucket\/upload$/);
      const del = url.pathname.match(/^\/storage\/test-bucket\/delete\/(.+)$/);
      if (req.method === "POST" && up) {
        const request = new Request("http://x", { method: "POST", headers: { "content-type": req.headers["content-type"]! }, body });
        const file = (await request.formData()).get("file") as File;
        if (bucket.has(file.name) && url.searchParams.get("overwrite") !== "true") { res.statusCode = 409; return res.end('{"error":"exists"}'); }
        bucket.set(file.name, Buffer.from(await file.arrayBuffer()));
        return res.end(JSON.stringify({ success: true, key: `123_${file.name}`, name: file.name, size: file.size, mimeType: file.type, fileId: "f" }));
      }
      if (req.method === "DELETE" && del) {
        const name = decodeURIComponent(del[1]);
        if (!bucket.delete(name)) { res.statusCode = 404; return res.end('{"error":"nf"}'); }
        return res.end('{"success":true}');
      }
      res.statusCode = 404; res.end("{}");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  // Snapshot real usage figures (if any) so this test can never destroy them.
  savedUsage = (await db.select().from(storageUsageManual)).map(({ id: _id, ...r }) => r);
  [{ id: userA }] = await db.insert(users).values({ telegramId: `${tag}_a` }).returning({ id: users.id });
  [{ id: userB }] = await db.insert(users).values({ telegramId: `${tag}_b` }).returning({ id: users.id });
  [{ id: fileA }] = await db.insert(files).values({ userId: userA, title: "A" }).returning({ id: files.id });
  [{ id: fileB }] = await db.insert(files).values({ userId: userB, title: "B" }).returning({ id: files.id });
});

afterAll(async () => {
  await db.delete(files).where(eq(files.id, fileA)); // cascades thumbnails
  await db.delete(files).where(eq(files.id, fileB));
  await db.delete(users).where(eq(users.id, userA));
  await db.delete(users).where(eq(users.id, userB));
  await db.delete(storageUsageManual);
  if (savedUsage.length) await db.insert(storageUsageManual).values(savedUsage);
  await db.delete(thumbnailFailures).where(eq(thumbnailFailures.userId, userA));
  await new Promise((r) => server.close(r));
});

const deps = (): ThumbnailDeps => ({
  repo: drizzleRepo,
  storage: new DbbyteStorage({ apiKey: "test-key", bucket: "test-bucket", cdnBaseUrl: "https://cdn.test/tok", apiBaseUrl: base }, { backoffMs: [1, 1], sleep: async () => {} }),
  process: processThumbnail,
  urlFor: (k) => `https://cdn.test/tok/test-bucket/${k}`,
});
const img = (c: string) => sharp({ create: { width: 800, height: 600, channels: 3, background: c } }).jpeg().toBuffer();

describe("service + real DB + DBByte-shaped HTTP server", () => {
  it("upload → replace → delete round trip with real SQL", async () => {
    const d = deps();
    const a = await uploadThumbnail({ userId: userA, fileId: fileA, bytes: await img("#f00") }, d);
    expect(a.ok).toBe(true);
    expect(bucket.size).toBe(1);
    let rows = await db.select().from(fileThumbnails).where(eq(fileThumbnails.fileId, fileA));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ provider: "dbbyte", status: "ready", userId: userA, mimeType: "image/webp" });
    expect(rows[0].objectKey).toMatch(/^thumb-\d+-\d+-[0-9a-f]{16}\.webp$/);

    const b = await uploadThumbnail({ userId: userA, fileId: fileA, bytes: await img("#00f") }, d);
    expect(b.ok).toBe(true);
    rows = await db.select().from(fileThumbnails).where(eq(fileThumbnails.fileId, fileA));
    expect(rows).toHaveLength(1); // upsert, one active thumbnail per file
    expect(bucket.size).toBe(1); // old object deleted after commit
    expect([...bucket.keys()][0]).toBe(rows[0].objectKey);
    if (a.ok && b.ok) expect(a.thumbnail.url).not.toBe(b.thumbnail.url);

    const map = await getThumbnailsForFiles([fileA, fileB]);
    expect(map.get(fileA)?.objectKey).toBe(rows[0].objectKey);
    expect(map.has(fileB)).toBe(false);

    const del = await removeThumbnail({ userId: userA, fileId: fileA }, d);
    expect(del).toEqual({ ok: true, removed: true });
    expect(bucket.size).toBe(0);
    expect(await db.select().from(fileThumbnails).where(eq(fileThumbnails.fileId, fileA))).toHaveLength(0);
  });

  it("another creator cannot touch the file (real ownership query)", async () => {
    const d = deps();
    expect(await uploadThumbnail({ userId: userB, fileId: fileA, bytes: await img("#0f0") }, d)).toMatchObject({ ok: false, status: 404 });
    await uploadThumbnail({ userId: userA, fileId: fileA, bytes: await img("#0f0") }, d);
    expect(await removeThumbnail({ userId: userB, fileId: fileA }, d)).toMatchObject({ ok: false, status: 404 });
    expect(bucket.size).toBe(1);
    await removeThumbnail({ userId: userA, fileId: fileA }, d);
  });

  it("deleting the file cascades the thumbnail row", async () => {
    const d = deps();
    const [{ id }] = await db.insert(files).values({ userId: userA, title: "tmp" }).returning({ id: files.id });
    await uploadThumbnail({ userId: userA, fileId: id, bytes: await img("#abc") }, d);
    await db.delete(files).where(eq(files.id, id));
    expect(await db.select().from(fileThumbnails).where(eq(fileThumbnails.fileId, id))).toHaveLength(0);
    for (const k of [...bucket.keys()]) bucket.delete(k);
  });

  it("usage gate: closed at ≥90% manual usage, open below; opens again after lowering", async () => {
    await db.delete(storageUsageManual);
    expect((await drizzleRepo.getUploadGate()).allowed).toBe(true);
    await db.insert(storageUsageManual).values({ metric: "storage_bytes", used: 18, limit: 20 }); // 90%
    expect(await drizzleRepo.getUploadGate()).toMatchObject({ allowed: false, level: "restricted" });
    const blocked = await uploadThumbnail({ userId: userA, fileId: fileA, bytes: await img("#f00") }, deps());
    expect(blocked).toMatchObject({ ok: false, code: "uploads_paused" });
    expect(bucket.size).toBe(0);
    await db.update(storageUsageManual).set({ used: 14 }); // 70% -> warning, still allowed
    expect(await drizzleRepo.getUploadGate()).toMatchObject({ allowed: true, level: "warning" });
    await db.delete(storageUsageManual);
  });

  it("provider quota rejection pauses uploads for a while", async () => {
    await db.insert(thumbnailFailures).values({ userId: userA, fileId: fileA, code: "quota_exceeded", httpStatus: 429 });
    expect(await drizzleRepo.getUploadGate()).toMatchObject({ allowed: false, reason: "provider_quota" });
    await db.delete(thumbnailFailures).where(eq(thumbnailFailures.userId, userA));
  });

  it("orphans are recorded once per object key", async () => {
    await drizzleRepo.addOrphan(`${tag}.webp`, "test");
    await drizzleRepo.addOrphan(`${tag}.webp`, "test");
    const rows = await db.select().from(thumbnailOrphans).where(eq(thumbnailOrphans.objectKey, `${tag}.webp`));
    expect(rows).toHaveLength(1);
    await db.delete(thumbnailOrphans).where(eq(thumbnailOrphans.objectKey, `${tag}.webp`));
  });
});
