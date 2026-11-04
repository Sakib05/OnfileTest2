/**
 * PostgreSQL integration tests. They run ONLY against a freshly created
 * scratch database (onfile_test_*), which is dropped afterwards. Provider
 * APIs are replaced by in-memory fakes, so no real provider quota is used.
 */
import { execSync } from "child_process";
import crypto from "crypto";
import pg from "pg";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeAdapter } from "./fakeAdapter";
import { ProviderError, PROVIDER_KEYS, type ProviderKey } from "../types";

const baseUrl = new URL(process.env.TEST_ADMIN_DATABASE_URL ?? process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/postgres");
const scratchName = `onfile_test_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
const adminUrl = new URL(baseUrl.toString());
adminUrl.pathname = "/postgres";
const scratchUrl = new URL(baseUrl.toString());
scratchUrl.pathname = `/${scratchName}`;

let m: any; // dynamically imported modules (after DATABASE_URL points at the scratch DB)
const fakes = {} as Record<ProviderKey, FakeAdapter>;
const noSleep = async () => {};

const GB = 1_000_000_000;
const env: Record<string, string> = {};
for (const k of PROVIDER_KEYS) {
  env[`${k.toUpperCase()}_STORAGE_QUOTA_BYTES`] = String(10 * GB);
  env[`${k.toUpperCase()}_BANDWIDTH_QUOTA_BYTES`] = String(50 * GB);
}

async function jpeg(seed = 1) {
  const w = 120, h = 80;
  const data = Buffer.alloc(w * h * 3);
  for (let i = 0; i < data.length; i++) data[i] = (i * 31 + seed * 17 + ((i / 5) | 0)) & 255;
  return sharp(data, { raw: { width: w, height: h, channels: 3 } }).resize(900, 600).jpeg({ quality: 80 }).toBuffer();
}

async function makeFile(published = true) {
  const [u] = await m.db.insert(m.schema.users).values({ telegramId: String(Math.floor(Math.random() * 1e9)), firstName: "T" }).returning();
  const [f] = await m.db.insert(m.schema.files).values({ userId: u.id, title: "f", isPublished: published, smartLinkSlug: crypto.randomBytes(5).toString("hex") }).returning();
  return { user: u, file: f };
}

function onlyConfigured(...keys: ProviderKey[]) {
  for (const k of PROVIDER_KEYS) fakes[k].configured = keys.includes(k);
}
function allConfigured() {
  for (const k of PROVIDER_KEYS) fakes[k].configured = true;
}
const totalObjects = () => PROVIDER_KEYS.reduce((s, k) => s + fakes[k].store.size, 0);
const activeAssets = async (fileId: number) =>
  (await m.db.select().from(m.schema.thumbnailAssets)).filter((a: any) => a.fileId === fileId && a.status === "active");
const providerRow = async (key: ProviderKey) => m.providers.getProviderByKey(key);

async function uploadOn(keys: ProviderKey[], fileId: number, ownerId: number, seed = 1) {
  onlyConfigured(...keys);
  const res = await m.thumbs.uploadThumbnail({ fileId, ownerId, image: await jpeg(seed), declaredMime: "image/jpeg" }, { sleep: noSleep });
  allConfigured();
  return res;
}

async function openJob(assetId: number, sourceProviderId: number) {
  const [job] = await m.db.insert(m.schema.storageMigrationJobs).values({ assetId, sourceProviderId, reason: "test" }).returning();
  return job;
}

beforeAll(async () => {
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${scratchName}`);
  await admin.end();
  execSync("npx drizzle-kit push --force", { env: { ...process.env, DATABASE_URL: scratchUrl.toString() }, stdio: "pipe" });
  process.env.DATABASE_URL = scratchUrl.toString();
  process.env.ADMIN_TELEGRAM_IDS = "1";
  delete process.env.TELEGRAM_BOT_TOKEN;
  m = {
    db: (await import("@/db")).db,
    pool: (await import("@/db")).pool,
    schema: await import("@/db/schema"),
    thumbs: await import("../thumbnails"),
    providers: await import("../providers"),
    migration: await import("../migration"),
    maintenance: await import("../maintenance"),
    adapters: await import("../adapters"),
    settings: await import("../settings"),
    admin: await import("../admin"),
    rl: await import("../sharedRateLimit"),
    orm: await import("drizzle-orm"),
  };
  expect((await m.pool.query("select current_database() as d")).rows[0].d).toBe(scratchName);
}, 180_000);

afterAll(async () => {
  if (m?.adapters) m.adapters.clearAdapterOverrides();
  await m?.pool?.end();
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${scratchName} WITH (FORCE)`);
  await admin.end();
}, 60_000);

beforeEach(async () => {
  await m.pool.query(
    "TRUNCATE thumbnail_assets, storage_migration_jobs, storage_provider_events, provider_usage_history, storage_audit_logs, storage_settings, storage_providers, storage_locks, storage_rate_limits, files, users RESTART IDENTITY CASCADE"
  );
  await m.providers.ensureProviders(env);
  for (const k of PROVIDER_KEYS) {
    fakes[k] = new FakeAdapter(k);
    m.adapters.setAdapterOverride(k, fakes[k]);
  }
});

describe("upload & allocation", () => {
  it("stores each thumbnail on exactly ONE provider and records why it was chosen", async () => {
    const { user, file } = await makeFile();
    const res = await m.thumbs.uploadThumbnail({ fileId: file.id, ownerId: user.id, image: await jpeg(), declaredMime: "image/jpeg" }, { sleep: noSleep, seed: "fixed" });
    expect(totalObjects()).toBe(1);
    const [asset] = await activeAssets(file.id);
    expect(asset.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(asset.allocationReason.summary).toContain(`selected ${res.providerKey}`);
    expect(asset.allocationReason.seed).toBe("fixed");
    expect(asset.mimeType).toBe("image/webp");
    expect(asset.width).toBeLessThanOrEqual(1280);
  });

  it("replacing a thumbnail keeps ONE active asset and deletes the old remote object", async () => {
    const { user, file } = await makeFile();
    await m.thumbs.uploadThumbnail({ fileId: file.id, ownerId: user.id, image: await jpeg(1) }, { sleep: noSleep });
    await m.thumbs.uploadThumbnail({ fileId: file.id, ownerId: user.id, image: await jpeg(2) }, { sleep: noSleep });
    expect((await activeAssets(file.id)).length).toBe(1);
    expect((await m.db.select().from(m.schema.thumbnailAssets)).length).toBe(1);
    expect(totalObjects()).toBe(1);
  });

  it("DB rejects a second active thumbnail for the same file", async () => {
    const { user, file } = await makeFile();
    await m.thumbs.uploadThumbnail({ fileId: file.id, ownerId: user.id, image: await jpeg() }, { sleep: noSleep });
    const [a] = await activeAssets(file.id);
    const { id: _id, ...rest } = a;
    void _id;
    await expect(m.db.insert(m.schema.thumbnailAssets).values({ ...rest, providerObjectKey: "other" })).rejects.toThrow();
  });

  it("rejects a wrong owner and invalid images without uploading anything", async () => {
    const { file } = await makeFile();
    const other = await makeFile();
    await expect(m.thumbs.uploadThumbnail({ fileId: file.id, ownerId: other.user.id, image: await jpeg() })).rejects.toMatchObject({ code: "not_found" });
    const { user } = { user: (await m.db.select().from(m.schema.users).where(m.orm.eq(m.schema.users.id, file.userId)))[0] };
    await expect(m.thumbs.uploadThumbnail({ fileId: file.id, ownerId: user.id, image: Buffer.from("<svg/>") })).rejects.toMatchObject({ name: "ImageValidationError" });
    expect(totalObjects()).toBe(0);
    expect((await m.db.select().from(m.schema.thumbnailAssets)).length).toBe(0);
  });

  it("retries 429 with Retry-After on the same provider, then succeeds", async () => {
    const { user, file } = await makeFile();
    let n = 0;
    fakes.dbbyte.uploadError = () => (++n <= 2 ? new ProviderError("rate_limited", "429", 429, 5) : null);
    const sleep = vi.fn(async (_ms: number) => { void _ms; });
    onlyConfigured("dbbyte");
    const res = await m.thumbs.uploadThumbnail({ fileId: file.id, ownerId: user.id, image: await jpeg() }, { sleep });
    expect(res.providerKey).toBe("dbbyte");
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([5, 5]);
  });

  it("fails over from 5xx providers to a healthy one and records the failures", async () => {
    const { user, file } = await makeFile();
    for (const k of ["imagekit", "cloudinary", "supabase"] as ProviderKey[]) fakes[k].uploadError = new ProviderError("server", "503", 503);
    // Deterministic: pick a seed whose draw tries a failing provider BEFORE the healthy one.
    const { allocate } = await import("../allocation");
    const { candidates } = await m.providers.loadCandidates();
    const settings = await m.settings.getSettings();
    let seed = "";
    for (let i = 0; i < 200 && !seed; i++) if (allocate(candidates, settings, { assetBytes: 1000, seed: `s${i}` }).order[0] !== "dbbyte") seed = `s${i}`;
    expect(seed).not.toBe("");
    const res = await m.thumbs.uploadThumbnail({ fileId: file.id, ownerId: user.id, image: await jpeg() }, { sleep: noSleep, seed });
    expect(res.providerKey).toBe("dbbyte");
    expect((await providerRow("imagekit")).consecutiveUploadFailures + (await providerRow("cloudinary")).consecutiveUploadFailures + (await providerRow("supabase")).consecutiveUploadFailures).toBeGreaterThan(0);
    expect((await providerRow("dbbyte")).consecutiveUploadFailures).toBe(0);
  });

  it("marks a provider ERROR on 401/403 (not EXHAUSTED) and EXHAUSTED on quota errors", async () => {
    const { user, file } = await makeFile();
    fakes.imagekit.uploadError = new ProviderError("auth", "403", 403);
    fakes.cloudinary.uploadError = new ProviderError("quota", "quota", 429);
    fakes.supabase.uploadError = new ProviderError("server", "500", 500);
    fakes.dbbyte.uploadError = new ProviderError("server", "500", 500);
    // run until all four have been tried (single call tries up to four providers)
    await expect(m.thumbs.uploadThumbnail({ fileId: file.id, ownerId: user.id, image: await jpeg() }, { sleep: noSleep })).rejects.toMatchObject({ code: "upload_failed" });
    const ik = await providerRow("imagekit");
    const cl = await providerRow("cloudinary");
    expect(ik.status).toBe("ERROR");
    expect(cl.status).toBe("EXHAUSTED");
    expect(cl.quotaErrorAt).not.toBeNull();
    // both are now excluded from allocation
    fakes.supabase.uploadError = null;
    const again = await m.thumbs.uploadThumbnail({ fileId: file.id, ownerId: user.id, image: await jpeg() }, { sleep: noSleep });
    expect(["supabase", "dbbyte"]).toContain(again.providerKey);
  });

  it("verifies before committing: a corrupted upload is deleted and another provider is used", async () => {
    const { user, file } = await makeFile();
    fakes.imagekit.corruptDownload = fakes.cloudinary.corruptDownload = fakes.supabase.corruptDownload = true;
    const res = await m.thumbs.uploadThumbnail({ fileId: file.id, ownerId: user.id, image: await jpeg() }, { sleep: noSleep });
    expect(res.providerKey).toBe("dbbyte");
    expect(totalObjects()).toBe(1); // corrupted copies were cleaned up
  });

  it("creates no DB record and cleans up when the DB commit fails", async () => {
    const { user, file } = await makeFile();
    onlyConfigured("supabase");
    fakes.supabase.onUpload = async () => { await m.db.delete(m.schema.files).where(m.orm.eq(m.schema.files.id, file.id)); };
    await expect(m.thumbs.uploadThumbnail({ fileId: file.id, ownerId: user.id, image: await jpeg() }, { sleep: noSleep })).rejects.toMatchObject({ code: "not_found" });
    expect(totalObjects()).toBe(0);
    expect((await m.db.select().from(m.schema.thumbnailAssets)).length).toBe(0);
  });

  it("reports unavailability when no provider is eligible", async () => {
    const { user, file } = await makeFile();
    onlyConfigured();
    await expect(m.thumbs.uploadThumbnail({ fileId: file.id, ownerId: user.id, image: await jpeg() })).rejects.toMatchObject({ code: "no_provider_available", status: 503 });
  });

  it("removing a thumbnail deletes the remote object; deleting the file sweeps it later", async () => {
    const { user, file } = await makeFile();
    await m.thumbs.uploadThumbnail({ fileId: file.id, ownerId: user.id, image: await jpeg() }, { sleep: noSleep });
    expect((await m.thumbs.removeThumbnail(file.id, user.id)).removed).toBe(true);
    expect(totalObjects()).toBe(0);
    await m.thumbs.uploadThumbnail({ fileId: file.id, ownerId: user.id, image: await jpeg() }, { sleep: noSleep });
    // Owner mismatch cannot remove
    const other = await makeFile();
    await expect(m.thumbs.removeThumbnail(file.id, other.user.id)).rejects.toMatchObject({ code: "not_found" });
    // File deleted behind our back -> orphan swept by maintenance
    await m.db.delete(m.schema.files).where(m.orm.eq(m.schema.files.id, file.id));
    expect(totalObjects()).toBe(1);
    await m.maintenance.runMaintenance();
    expect(totalObjects()).toBe(0);
  });
});

describe("secure delivery", () => {
  it("redirects to a short-lived signed URL when the provider supports it", async () => {
    const { user, file } = await makeFile();
    const { providerKey } = await uploadOn(["supabase"], file.id, user.id);
    const res: Response = await m.thumbs.deliverThumbnail(file.id);
    expect(providerKey).toBe("supabase");
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("location")!);
    expect(Number(loc.searchParams.get("exp"))).toBeLessThanOrEqual(Date.now() + 301_000);
    expect(Number(loc.searchParams.get("exp"))).toBeGreaterThan(Date.now());
    expect(res.headers.get("cache-control")).toMatch(/private/);
  });

  it("streams through the server (no permanent URL) when the provider cannot expire URLs", async () => {
    const { user, file } = await makeFile();
    fakes.cloudinary.clientSafe = false;
    await uploadOn(["cloudinary"], file.id, user.id);
    const res: Response = await m.thumbs.deliverThumbnail(file.id);
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    const [asset] = await activeAssets(file.id);
    expect(Buffer.from(await res.arrayBuffer()).length).toBe(asset.fileSize);
  });

  it("returns 404 without a thumbnail and 502 (plus failure accounting) when the provider fails", async () => {
    const { user, file } = await makeFile();
    expect((await m.thumbs.deliverThumbnail(file.id)).status).toBe(404);
    await uploadOn(["dbbyte"], file.id, user.id);
    fakes.dbbyte.clientSafe = false;
    fakes.dbbyte.downloadError = new ProviderError("server", "boom", 500);
    const res: Response = await m.thumbs.deliverThumbnail(file.id);
    expect(res.status).toBe(502);
    expect((await providerRow("dbbyte")).consecutiveDeliveryFailures).toBeGreaterThan(0);
  });
});

describe("migration", () => {
  async function seeded(from: ProviderKey = "imagekit") {
    const { user, file } = await makeFile();
    await uploadOn([from], file.id, user.id);
    const [asset] = await activeAssets(file.id);
    const src = await providerRow(from);
    const job = await openJob(asset.id, src.id);
    return { user, file, asset, src, job };
  }
  const reload = async (id: number) => (await m.db.select().from(m.schema.thumbnailAssets).where(m.orm.eq(m.schema.thumbnailAssets.id, id)))[0];
  const jobRow = async (id: number) => (await m.db.select().from(m.schema.storageMigrationJobs).where(m.orm.eq(m.schema.storageMigrationJobs.id, id)))[0];
  const okDelivery = { verifyDelivery: async () => {}, sleep: noSleep };

  it("migrates: uploads, verifies checksum, swaps the pointer, deletes the old object LAST", async () => {
    const { asset, job } = await seeded();
    const order: string[] = [];
    const origDelete = fakes.imagekit.delete.bind(fakes.imagekit);
    fakes.imagekit.delete = async (ref) => { order.push("old-delete"); return origDelete(ref); };
    const res = await m.migration.runMigrationJob(job.id, { ...okDelivery, verifyDelivery: async () => { order.push("verify-delivery"); } });
    expect(res.status).toBe("completed");
    expect(order).toEqual(["verify-delivery", "old-delete"]);
    const after = await reload(asset.id);
    expect(after.providerId).not.toBe(asset.providerId);
    expect(after.version).toBe(asset.version + 1);
    expect(fakes.imagekit.store.size).toBe(0);
    expect(totalObjects()).toBe(1);
    const dest = PROVIDER_KEYS.find((k) => fakes[k].store.size === 1)!;
    expect(fakes[dest].checksumOf(after.providerObjectKey)).toBe(asset.checksum);
    expect((await jobRow(job.id)).status).toBe("completed");
  });

  it("keeps the old reference and schedules a retry when the destination upload fails", async () => {
    const { asset, job } = await seeded();
    for (const k of ["cloudinary", "supabase", "dbbyte"] as ProviderKey[]) fakes[k].uploadError = new ProviderError("server", "503", 503);
    const res = await m.migration.runMigrationJob(job.id, okDelivery);
    expect(res.status).toBe("retry");
    const after = await reload(asset.id);
    expect(after.providerObjectKey).toBe(asset.providerObjectKey);
    expect(fakes.imagekit.store.has(asset.providerObjectKey)).toBe(true);
    const j = await jobRow(job.id);
    expect(j.status).toBe("pending");
    expect(j.retryCount).toBe(1);
    expect(j.errorDetails).toBeTruthy();
    expect(new Date(j.nextAttemptAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("aborts on a source checksum mismatch without touching anything", async () => {
    const { asset, job } = await seeded();
    fakes.imagekit.corruptDownload = true;
    const res = await m.migration.runMigrationJob(job.id, okDelivery);
    expect(res.status).toBe("retry");
    expect((await jobRow(job.id)).errorDetails).toContain("checksum");
    expect((await reload(asset.id)).providerObjectKey).toBe(asset.providerObjectKey);
    expect(totalObjects()).toBe(1);
  });

  it("cleans up the destination copy when destination verification mismatches", async () => {
    const { asset, job } = await seeded();
    for (const k of ["cloudinary", "supabase", "dbbyte"] as ProviderKey[]) fakes[k].corruptDownload = true;
    const res = await m.migration.runMigrationJob(job.id, okDelivery);
    expect(res.status).toBe("retry");
    expect(totalObjects()).toBe(1);
    expect((await reload(asset.id)).providerObjectKey).toBe(asset.providerObjectKey);
  });

  it("compare-and-swap: an asset modified mid-migration is NOT overwritten and the stray copy is deleted", async () => {
    const { asset, job } = await seeded();
    for (const k of ["cloudinary", "supabase", "dbbyte"] as ProviderKey[]) {
      fakes[k].onUpload = async () => {
        await m.db.update(m.schema.thumbnailAssets).set({ version: m.orm.sql`${m.schema.thumbnailAssets.version} + 1` }).where(m.orm.eq(m.schema.thumbnailAssets.id, asset.id));
      };
    }
    const res = await m.migration.runMigrationJob(job.id, okDelivery);
    expect(res.status).toBe("cancelled");
    expect((await reload(asset.id)).providerId).toBe(asset.providerId);
    expect(totalObjects()).toBe(1);
    expect(fakes.imagekit.store.size).toBe(1);
  });

  it("only one of two concurrent runners performs the migration", async () => {
    const { asset, job } = await seeded();
    const [a, b] = await Promise.all([m.migration.runMigrationJob(job.id, okDelivery), m.migration.runMigrationJob(job.id, okDelivery)]);
    expect([a.status, b.status].sort()).toEqual(["completed", "skipped"]);
    expect(totalObjects()).toBe(1);
    expect((await reload(asset.id)).version).toBe(asset.version + 1);
  });

  it("allows at most one open job per asset", async () => {
    const { asset, src } = await seeded();
    await expect(openJob(asset.id, src.id)).rejects.toThrow();
    const r = await m.migration.enqueueMigrations(src.id, { reason: "t" });
    expect(r.enqueued).toBe(0);
  });

  it("queues a tombstone when the old object cannot be deleted, and the sweeper removes it later", async () => {
    const { asset, job } = await seeded();
    fakes.imagekit.deleteError = new ProviderError("server", "500", 500);
    const res = await m.migration.runMigrationJob(job.id, okDelivery);
    expect(res.status).toBe("completed");
    const rows = await m.db.select().from(m.schema.thumbnailAssets);
    expect(rows.filter((r: any) => r.status === "pending_delete").length).toBe(1);
    expect(fakes.imagekit.store.size).toBe(1); // still there, tracked for cleanup
    fakes.imagekit.deleteError = null;
    expect(await m.thumbs.purgeAssetsBatch(10)).toBe(1);
    expect(fakes.imagekit.store.size).toBe(0);
    expect((await m.db.select().from(m.schema.thumbnailAssets)).length).toBe(1);
    expect((await reload(asset.id)).status).toBe("active");
  });

  it("limits retries, then admin retry re-queues the failed job", async () => {
    await m.settings.updateSettings({ migrationMaxRetries: 2 });
    const { job } = await seeded();
    for (const k of ["cloudinary", "supabase", "dbbyte"] as ProviderKey[]) fakes[k].uploadError = new ProviderError("server", "503", 503);
    const future = (h: number) => () => new Date(Date.now() + h * 3600_000);
    expect((await m.migration.runMigrationJob(job.id, { ...okDelivery, now: future(1) })).status).toBe("retry");
    expect((await m.migration.runMigrationJob(job.id, { ...okDelivery, now: future(10) })).status).toBe("failed");
    expect((await jobRow(job.id)).status).toBe("failed");
    expect((await m.migration.runMigrationJob(job.id, { ...okDelivery, now: future(20) })).status).toBe("skipped");
    expect(await m.migration.retryFailedJob(job.id)).toBe(true);
    const j = await jobRow(job.id);
    expect(j.status).toBe("pending");
    expect(j.retryCount).toBe(0);
  });

  it("rolls the pointer back when the new delivery cannot be verified", async () => {
    const { asset, job } = await seeded();
    const res = await m.migration.runMigrationJob(job.id, { sleep: noSleep, verifyDelivery: async () => { throw new Error("delivery broken"); } });
    expect(res.status).toBe("retry");
    const after = await reload(asset.id);
    expect(after.providerId).toBe(asset.providerId);
    expect(after.providerObjectKey).toBe(asset.providerObjectKey);
    expect(totalObjects()).toBe(1);
    expect(fakes.imagekit.store.size).toBe(1);
  });

  it("never migrates to disabled, exhausted or unhealthy destinations", async () => {
    const { src, job } = await seeded();
    for (const k of ["cloudinary", "supabase", "dbbyte"] as ProviderKey[]) {
      const row = await providerRow(k);
      await m.db.update(m.schema.storageProviders).set(k === "cloudinary" ? { enabled: false, status: "DISABLED" } : k === "supabase" ? { status: "EXHAUSTED" } : { status: "ERROR" }).where(m.orm.eq(m.schema.storageProviders.id, row.id));
    }
    const res = await m.migration.runMigrationJob(job.id, okDelivery);
    expect(res.status).toBe("retry");
    expect((await jobRow(job.id)).errorDetails).toContain("No eligible destination");
    expect(totalObjects()).toBe(1);
    // and enqueue itself refuses when no destination has capacity
    await m.db.delete(m.schema.storageMigrationJobs);
    expect((await m.migration.enqueueMigrations(src.id, { reason: "t" })).blockedReason).toBe("no_destination_capacity");
  });
});

describe("maintenance, quotas, monitoring & admin", () => {
  it("evaluates quotas (80% near limit, 90% exhausted) and drains an exhausted provider via migration", async () => {
    const { user, file } = await makeFile();
    await uploadOn(["imagekit"], file.id, user.id);
    const ik = await providerRow("imagekit");
    const set = (used: number) => m.db.update(m.schema.storageProviders).set({ storageUsed: used }).where(m.orm.eq(m.schema.storageProviders.id, ik.id));
    await set(8.5 * GB);
    expect((await m.providers.applyStatusEvaluation(ik.id)).status).toBe("NEAR_LIMIT");
    await set(9.5 * GB);
    expect((await m.providers.applyStatusEvaluation(ik.id)).status).toBe("EXHAUSTED");
    // maintenance: health OK, usage 'sync' keeps MANUAL-ish numbers via ESTIMATE, migration scheduled + processed
    for (const k of PROVIDER_KEYS) fakes[k].usage = { supported: false, reason: "fake" };
    await m.db.update(m.schema.storageProviders).set({ usageDetails: { manual: { storage: true } } }).where(m.orm.eq(m.schema.storageProviders.id, ik.id));
    const report = await m.maintenance.runMaintenance({ migrationDeps: { verifyDelivery: async () => {}, sleep: noSleep } });
    expect(report.skipped).toBeUndefined();
    expect(report.migrationsEnqueued).toBe(1);
    expect(report.migrationsProcessed.completed).toBe(1);
    expect(fakes.imagekit.store.size).toBe(0);
    expect((await activeAssets(file.id))[0].providerId).not.toBe(ik.id);
  });

  it("prevents concurrent maintenance runs (lease lock)", async () => {
    expect(await m.maintenance.acquireLock("storage-maintenance", "holder-a", 60)).toBe(true);
    const r = await m.maintenance.runMaintenance();
    expect(r.skipped).toBe("locked");
    expect(await m.maintenance.acquireLock("storage-maintenance", "holder-b", 60)).toBe(false);
    await m.maintenance.releaseLock("storage-maintenance", "holder-a");
    expect(await m.maintenance.acquireLock("storage-maintenance", "holder-b", 60)).toBe(true);
  });

  it("labels usage sources honestly (OFFICIAL_API / ESTIMATED / MANUAL / UNKNOWN)", async () => {
    fakes.imagekit.usage = { supported: true, value: { storageBytes: 1000, bandwidthBytes: 2000 } };
    await m.maintenance.syncProviderUsage(await providerRow("imagekit"));
    const ik = await providerRow("imagekit");
    expect(ik.storageUsed).toBe(1000);
    expect(ik.bandwidthUsed).toBe(2000);
    expect(ik.usageDetails.metricSources).toMatchObject({ storage: "OFFICIAL_API", bandwidth: "OFFICIAL_API", requests: "UNKNOWN" });
    expect(ik.usageSource).toBe("UNKNOWN"); // least reliable metric wins
    await m.maintenance.syncProviderUsage(await providerRow("supabase"));
    const sb = await providerRow("supabase");
    expect(sb.usageDetails.metricSources).toMatchObject({ storage: "ESTIMATED", bandwidth: "UNKNOWN" });
    expect(sb.lastUsageSync).not.toBeNull();
  });

  it("resets monthly counters only on the configured billing cycle (never blindly on the 1st)", async () => {
    const row = await providerRow("dbbyte");
    await m.db.update(m.schema.storageProviders).set({ bandwidthUsed: 5 * GB, requestUsed: 100, billingCycleDay: null }).where(m.orm.eq(m.schema.storageProviders.id, row.id));
    expect(await m.maintenance.rolloverBillingPeriod(await providerRow("dbbyte"), new Date("2030-05-01T00:00:00Z"))).toBe(false);
    expect((await providerRow("dbbyte")).bandwidthUsed).toBe(5 * GB);
    await m.db.update(m.schema.storageProviders).set({ billingCycleDay: 15, billingPeriodStart: new Date("2030-04-15T00:00:00Z") }).where(m.orm.eq(m.schema.storageProviders.id, row.id));
    expect(await m.maintenance.rolloverBillingPeriod(await providerRow("dbbyte"), new Date("2030-05-10T00:00:00Z"))).toBe(false);
    expect(await m.maintenance.rolloverBillingPeriod(await providerRow("dbbyte"), new Date("2030-05-16T00:00:00Z"))).toBe(true);
    const after = await providerRow("dbbyte");
    expect(after.bandwidthUsed).toBe(0);
    expect(after.requestUsed).toBe(0);
  });

  it("health: auth failure => ERROR immediately; transient failure => ERROR only when repeated; recovery clears it", async () => {
    fakes.imagekit.health = { ok: false, latencyMs: 1, detail: "401", authFailure: true };
    await m.maintenance.runHealthCheck(await providerRow("imagekit"));
    expect((await providerRow("imagekit")).status).toBe("ERROR");
    fakes.supabase.health = { ok: false, latencyMs: 1, detail: "timeout" };
    await m.maintenance.runHealthCheck(await providerRow("supabase"));
    expect((await providerRow("supabase")).status).toBe("ACTIVE");
    await m.maintenance.runHealthCheck(await providerRow("supabase"));
    expect((await providerRow("supabase")).status).toBe("ERROR");
    fakes.imagekit.health = { ok: true, latencyMs: 1 };
    await m.maintenance.runHealthCheck(await providerRow("imagekit"));
    expect((await providerRow("imagekit")).status).toBe("ACTIVE");
  });

  it("de-duplicates alerts within the cooldown window", async () => {
    const alerts = await import("../alerts");
    const sent = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    process.env.TELEGRAM_BOT_TOKEN = "123:TEST";
    const a = await alerts.raiseAlert({ eventType: "x", severity: "error", message: "m", dedupeKey: "dup-key" });
    const b = await alerts.raiseAlert({ eventType: "x", severity: "error", message: "m", dedupeKey: "dup-key" });
    delete process.env.TELEGRAM_BOT_TOKEN;
    sent.mockRestore();
    expect(a).toMatchObject({ notified: true, suppressed: false });
    expect(b).toMatchObject({ notified: false, suppressed: true });
  });

  it("shared (database-backed) rate limiter enforces limits across calls", async () => {
    const results = [];
    for (let i = 0; i < 4; i++) results.push((await m.rl.sharedRateLimit("t:k", 3, 60)).allowed);
    expect(results).toEqual([true, true, true, false]);
    expect((await m.rl.sharedRateLimit("t:other", 3, 60)).allowed).toBe(true);
  });

  it("admin actions are validated and audited", async () => {
    const actor = { id: (await makeFile()).user.id, telegramId: "1" };
    expect(await m.admin.runAdminAction(actor, { action: "setEnabled", providerKey: "dbbyte", enabled: false })).toMatchObject({ ok: true });
    expect((await providerRow("dbbyte")).status).toBe("DISABLED");
    expect(await m.admin.runAdminAction(actor, { action: "setEnabled", providerKey: "dbbyte", enabled: true })).toMatchObject({ ok: true });
    expect((await providerRow("dbbyte")).status).toBe("ACTIVE");
    expect(await m.admin.runAdminAction(actor, { action: "setQuotas", providerKey: "imagekit", storageQuota: 5 * GB, bandwidthUsed: 123 })).toMatchObject({ ok: true });
    const ik = await providerRow("imagekit");
    expect(ik.storageQuota).toBe(5 * GB);
    expect(ik.bandwidthUsed).toBe(123);
    expect(ik.usageDetails.manual.bandwidth).toBe(true);
    expect(await m.admin.runAdminAction(actor, { action: "setQuotas", providerKey: "imagekit", storageQuota: -1 })).toMatchObject({ ok: false, status: 400 });
    expect(await m.admin.runAdminAction(actor, { action: "setWeight", providerKey: "imagekit", weight: 500 })).toMatchObject({ ok: false });
    expect(await m.admin.runAdminAction(actor, { action: "setSettings", settings: { warnPercent: 95 } })).toMatchObject({ ok: false });
    expect(await m.admin.runAdminAction(actor, { action: "setSettings", settings: { warnPercent: 70, criticalPercent: 85 } })).toMatchObject({ ok: true });
    expect(await m.admin.runAdminAction(actor, { action: "nope", providerKey: "dbbyte" })).toMatchObject({ ok: false });
    expect(await m.admin.runAdminAction(actor, { action: "setEnabled", providerKey: "r2", enabled: true })).toMatchObject({ ok: false });
    const audit = await m.db.select().from(m.schema.storageAuditLogs);
    expect(audit.map((a: any) => a.action)).toEqual(expect.arrayContaining(["setEnabled", "setQuotas", "setSettings"]));
    expect(audit.every((a: any) => a.actorTelegramId === "1")).toBe(true);
  });

  it("dashboard snapshot exposes configuration booleans only (no credentials) and all four providers", async () => {
    process.env.IMAGEKIT_PRIVATE_KEY = "super-secret-private-key";
    const snap = await m.admin.buildSnapshot();
    delete process.env.IMAGEKIT_PRIVATE_KEY;
    expect(snap.providers.map((p: any) => p.key).sort()).toEqual([...PROVIDER_KEYS].sort());
    expect(JSON.stringify(snap)).not.toContain("super-secret-private-key");
    expect(snap).toHaveProperty("allocation.nextUploadPreview");
    expect(snap).toHaveProperty("migrations.counts");
    expect(["HEALTHY", "DEGRADED", "CRITICAL"]).toContain(snap.systemHealth);
  });
});
