import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  fileThumbnails,
  files,
  storageUsageManual,
  thumbnailFailures,
  thumbnailOrphans,
} from "@/db/schema";
import { getUsageThresholds } from "./config";
import { maxLevel, uploadsBlocked, usageLevel, usagePercent, type UsageLevel } from "./usage";

export interface ThumbnailRow {
  objectKey: string;
  version: string;
  width: number;
  height: number;
  sizeBytes: number;
  mimeType: string;
}

export interface CommitInput {
  userId: number;
  fileId: number;
  objectKey: string;
  version: string;
  mimeType: string;
  format: string;
  sizeBytes: number;
  width: number;
  height: number;
}

export interface UploadGate {
  allowed: boolean;
  level: UsageLevel;
  reason?: "usage" | "provider_quota";
}

/** Persistence seam so the service can be unit-tested without a database. */
export interface ThumbnailRepo {
  findOwnedFile(userId: number, fileId: number): Promise<boolean>;
  commitThumbnail(input: CommitInput): Promise<{ previousKey: string | null }>;
  removeThumbnail(userId: number, fileId: number): Promise<{ objectKey: string } | null>;
  getThumbnailKey(userId: number, fileId: number): Promise<string | null>;
  addOrphan(objectKey: string, reason: string, error?: string): Promise<void>;
  recordFailure(f: { userId?: number; fileId?: number; code: string; httpStatus?: number; message?: string }): Promise<void>;
  getUploadGate(): Promise<UploadGate>;
}

const PROVIDER = "dbbyte";

export const drizzleRepo: ThumbnailRepo = {
  async findOwnedFile(userId, fileId) {
    const [row] = await db
      .select({ id: files.id })
      .from(files)
      .where(and(eq(files.id, fileId), eq(files.userId, userId)))
      .limit(1);
    return !!row;
  },

  async commitThumbnail(input) {
    return db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ objectKey: fileThumbnails.objectKey })
        .from(fileThumbnails)
        .where(eq(fileThumbnails.fileId, input.fileId))
        .for("update");
      const now = new Date();
      if (existing) {
        await tx
          .update(fileThumbnails)
          .set({
            userId: input.userId,
            provider: PROVIDER,
            objectKey: input.objectKey,
            version: input.version,
            mimeType: input.mimeType,
            format: input.format,
            sizeBytes: input.sizeBytes,
            width: input.width,
            height: input.height,
            status: "ready",
            updatedAt: now,
          })
          .where(eq(fileThumbnails.fileId, input.fileId));
      } else {
        await tx.insert(fileThumbnails).values({
          userId: input.userId,
          fileId: input.fileId,
          provider: PROVIDER,
          objectKey: input.objectKey,
          version: input.version,
          mimeType: input.mimeType,
          format: input.format,
          sizeBytes: input.sizeBytes,
          width: input.width,
          height: input.height,
          status: "ready",
        });
      }
      return { previousKey: existing?.objectKey ?? null };
    });
  },

  async removeThumbnail(userId, fileId) {
    const [row] = await db
      .delete(fileThumbnails)
      .where(and(eq(fileThumbnails.fileId, fileId), eq(fileThumbnails.userId, userId)))
      .returning({ objectKey: fileThumbnails.objectKey });
    return row ?? null;
  },

  async getThumbnailKey(userId, fileId) {
    const [row] = await db
      .select({ objectKey: fileThumbnails.objectKey })
      .from(fileThumbnails)
      .where(and(eq(fileThumbnails.fileId, fileId), eq(fileThumbnails.userId, userId)))
      .limit(1);
    return row?.objectKey ?? null;
  },

  async addOrphan(objectKey, reason, error) {
    await db
      .insert(thumbnailOrphans)
      .values({ provider: PROVIDER, objectKey, reason, lastError: error?.slice(0, 300) })
      .onConflictDoNothing();
  },

  async recordFailure(f) {
    await db.insert(thumbnailFailures).values({
      userId: f.userId,
      fileId: f.fileId,
      code: f.code.slice(0, 48),
      httpStatus: f.httpStatus,
      message: f.message?.slice(0, 300),
    });
  },

  async getUploadGate() {
    const t = getUsageThresholds();
    const rows = await db.select().from(storageUsageManual);
    const level = maxLevel(rows.map((r) => usageLevel(usagePercent(r.used, r.limit), t)));
    if (uploadsBlocked(level)) return { allowed: false, level, reason: "usage" };

    // Provider quota rejection (HTTP 429 without Retry-After) in the last 15 min
    // pauses uploads so we don't hammer DBByte (every attempt costs a request).
    const since = new Date(Date.now() - 15 * 60 * 1000);
    const [recent] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(thumbnailFailures)
      .where(and(eq(thumbnailFailures.code, "quota_exceeded"), gte(thumbnailFailures.createdAt, since)));
    if ((recent?.n ?? 0) > 0) return { allowed: false, level: "full", reason: "provider_quota" };
    return { allowed: true, level };
  },
};

// ─── Read helpers used by the library / public link APIs ─────────────────────

/** fileId -> thumbnail metadata. Never throws: a missing table must not break listings. */
export async function getThumbnailsForFiles(fileIds: number[]): Promise<Map<number, ThumbnailRow>> {
  const map = new Map<number, ThumbnailRow>();
  if (fileIds.length === 0) return map;
  try {
    const rows = await db
      .select({
        fileId: fileThumbnails.fileId,
        objectKey: fileThumbnails.objectKey,
        version: fileThumbnails.version,
        width: fileThumbnails.width,
        height: fileThumbnails.height,
        sizeBytes: fileThumbnails.sizeBytes,
        mimeType: fileThumbnails.mimeType,
      })
      .from(fileThumbnails)
      .where(and(inArray(fileThumbnails.fileId, fileIds), eq(fileThumbnails.status, "ready")));
    for (const r of rows) map.set(r.fileId, r);
  } catch (err) {
    console.error("thumbnail_lookup_failed", err instanceof Error ? err.message : "unknown_error");
  }
  return map;
}

// ─── Admin helpers ───────────────────────────────────────────────────────────

export async function listOrphans(limit = 50, maxAttempts = 10) {
  return db
    .select()
    .from(thumbnailOrphans)
    .where(lt(thumbnailOrphans.attempts, maxAttempts))
    .orderBy(thumbnailOrphans.createdAt)
    .limit(limit);
}

export async function deleteOrphanRow(id: number) {
  await db.delete(thumbnailOrphans).where(eq(thumbnailOrphans.id, id));
}

export async function bumpOrphanAttempt(id: number, error: string) {
  await db
    .update(thumbnailOrphans)
    .set({ attempts: sql`${thumbnailOrphans.attempts} + 1`, lastError: error.slice(0, 300), lastAttemptAt: new Date() })
    .where(eq(thumbnailOrphans.id, id));
}

export async function getAdminSnapshot() {
  const [manual, estimated, orphanCount, failures, failureCount] = await Promise.all([
    db.select().from(storageUsageManual),
    db
      .select({
        count: sql<number>`count(*)::int`,
        bytes: sql<number>`coalesce(sum(${fileThumbnails.sizeBytes}), 0)::bigint`,
      })
      .from(fileThumbnails),
    db.select({ n: sql<number>`count(*)::int` }).from(thumbnailOrphans),
    db.select().from(thumbnailFailures).orderBy(desc(thumbnailFailures.createdAt)).limit(15),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(thumbnailFailures)
      .where(gte(thumbnailFailures.createdAt, new Date(Date.now() - 7 * 24 * 3600 * 1000))),
  ]);
  return {
    manual,
    estimated: { thumbnails: estimated[0]?.count ?? 0, bytes: Number(estimated[0]?.bytes ?? 0) },
    orphanCount: orphanCount[0]?.n ?? 0,
    failures,
    failuresLast7d: failureCount[0]?.n ?? 0,
  };
}

export async function upsertManualUsage(metric: string, used: number, limit: number, userId: number) {
  const now = new Date();
  await db
    .insert(storageUsageManual)
    .values({ metric, used, limit, updatedBy: userId, updatedAt: now })
    .onConflictDoUpdate({
      target: storageUsageManual.metric,
      set: { used, limit, updatedBy: userId, updatedAt: now },
    });
}
