import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { files, playlists, reports, users } from "@/db/schema";
import { POST } from "./route";

/** REAL route handler + REAL Postgres: the public Report endpoint (file + playlist targets, validation, abuse protection). */
const tag = `rp_${Date.now()}`;
let userId = 0;
let fileId = 0;
let hiddenFileId = 0;
let playlistId = 0;
let ipSeq = 0;
const FILE = `${tag}-pub`;
const HIDDEN = `${tag}-hid`;
const SHARE = `Sh${Date.now().toString(36)}abcdefghijklm`.slice(0, 20).padEnd(16, "x");
const PRIVATE_SHARE = `Pr${Date.now().toString(36)}abcdefghijklm`.slice(0, 20).padEnd(16, "y");

function req(json: unknown, init: { ip?: string; origin?: string; raw?: string } = {}) {
  const headers: Record<string, string> = { host: "localhost", "content-type": "application/json", "x-forwarded-for": init.ip ?? `10.77.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}` };
  if (init.origin) headers.origin = init.origin;
  return new NextRequest("http://localhost/api/reports", { method: "POST", headers, body: init.raw ?? JSON.stringify(json) });
}
const rowsFor = async (col: "fileId" | "playlistId", id: number) => db.select().from(reports).where(eq(reports[col], id));

beforeAll(async () => {
  const [u] = await db.insert(users).values({ telegramId: `${tag}_u`, username: "rp_owner", firstName: "Owner" }).returning();
  userId = u.id;
  const base = { userId, fileType: "document" as const, telegramMessageLink: "https://t.me/c/1/1", telegramFileId: "secret-file-id" };
  const [f] = await db.insert(files).values({ ...base, title: "Public", smartLinkSlug: FILE, isPublished: true }).returning();
  const [h] = await db.insert(files).values({ ...base, title: "Unpublished", smartLinkSlug: HIDDEN, isPublished: false }).returning();
  fileId = f.id;
  hiddenFileId = h.id;
  const [p] = await db.insert(playlists).values({ userId, title: "Shared", isPublished: true, shareSlug: SHARE }).returning();
  playlistId = p.id;
  await db.insert(playlists).values({ userId, title: "Private", isPublished: false, shareSlug: PRIVATE_SHARE });
});

afterAll(async () => {
  await db.delete(reports).where(inArray(reports.fileId, [fileId, hiddenFileId].filter(Boolean)));
  if (playlistId) await db.delete(reports).where(eq(reports.playlistId, playlistId));
  await db.delete(files).where(eq(files.userId, userId));
  await db.delete(playlists).where(eq(playlists.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
});

describe("POST /api/reports", () => {
  it("stores a file report resolved from its public slug and returns only { ok: true }", async () => {
    const res = await POST(req({ target: "file", slug: FILE, reason: "copyright", details: "  stolen  " }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true }); // nothing about the target or the stored row is echoed
    const rows = await rowsFor("fileId", fileId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ reason: "copyright", description: "stolen", playlistId: null, status: "pending" });
  });

  it("stores a playlist report against the playlist (not a file)", async () => {
    const res = await POST(req({ target: "playlist", slug: SHARE, reason: "inappropriate" }));
    expect(res.status).toBe(201);
    const rows = await rowsFor("playlistId", playlistId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ reason: "inappropriate", fileId: null });
  });

  it("only publicly reachable targets can be reported (unpublished file, private/unknown playlist → 404, nothing stored)", async () => {
    expect((await POST(req({ target: "file", slug: HIDDEN, reason: "spam" }))).status).toBe(404);
    expect((await POST(req({ target: "file", slug: `${tag}-nope`, reason: "spam" }))).status).toBe(404);
    expect((await POST(req({ target: "playlist", slug: PRIVATE_SHARE, reason: "spam" }))).status).toBe(404);
    expect(await rowsFor("fileId", hiddenFileId)).toHaveLength(0);
  });

  it("validates the body: unknown reason/target, numeric ids, bad JSON, oversized payloads", async () => {
    expect((await POST(req({ target: "file", slug: FILE, reason: "because" }))).status).toBe(400);
    expect((await POST(req({ target: "file", fileId, reason: "spam" }))).status).toBe(400); // internal ids are not accepted
    expect((await POST(req(null, { raw: "{nope" }))).status).toBe(400);
    expect((await POST(req({ target: "file", slug: FILE, reason: "other", details: "x".repeat(6000) }))).status).toBe(413);
  });

  it("rejects cross-origin requests", async () => {
    expect((await POST(req({ target: "file", slug: FILE, reason: "spam" }, { origin: "https://evil.example" }))).status).toBe(403);
  });

  it("de-duplicates the same reporter + target + reason, but accepts a different reason", async () => {
    const ip = "10.99.0.1";
    const body = { target: "file", slug: FILE, reason: "spam" };
    expect((await POST(req(body, { ip }))).status).toBe(201);
    expect((await POST(req(body, { ip }))).status).toBe(201); // acknowledged…
    const spam = (await rowsFor("fileId", fileId)).filter((r) => r.reason === "spam" && r.reporterIp === ip);
    expect(spam).toHaveLength(1); // …but stored once
    expect((await POST(req({ ...body, reason: "other" }, { ip }))).status).toBe(201);
    expect((await rowsFor("fileId", fileId)).filter((r) => r.reporterIp === ip)).toHaveLength(2);
  });

  it("silently ignores honeypot submissions (nothing stored)", async () => {
    const ip = "10.99.0.2";
    const res = await POST(req({ target: "file", slug: FILE, reason: "broken_link", website: "http://bot" }, { ip }));
    expect(res.status).toBe(201);
    expect((await rowsFor("fileId", fileId)).filter((r) => r.reporterIp === ip)).toHaveLength(0);
  });

  it("rate limits a single IP", async () => {
    const ip = "10.99.0.3";
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await POST(req({ target: "file", slug: FILE, reason: "other", details: `n${i}` }, { ip }))).status);
    expect(statuses.slice(0, 5).every((s) => s === 201)).toBe(true);
    expect(statuses.slice(5)).toEqual([429, 429]);
  });
});
