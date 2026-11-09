import http from "http";
import type { AddressInfo } from "net";
import { NextRequest } from "next/server";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, like } from "drizzle-orm";
import { db } from "@/db";
import { channels, files, fileThumbnails, playlists, sessions, thumbnailOrphans, thumbnailUploads, users } from "@/db/schema";
import { createSession } from "@/lib/auth";
import { dbPublishDeps } from "@/lib/publishing/publishDeps";
import { publishPost } from "@/lib/publishing/publishPost";
import { purgeStaleStagedThumbnails } from "@/lib/thumbnails/staged";
import { POST as stagePost } from "./route";
import { DELETE as stageDelete } from "./[ref]/route";
import { GET as playlistsGet, POST as playlistsPost } from "../playlists/route";
import { DELETE as playlistDelete, PATCH as playlistPatch } from "../playlists/[id]/route";
import { PATCH as filePatch } from "../files/[id]/route";
import { GET as linkGet } from "../link/[slug]/route";

/**
 * End-to-end: REAL route handlers + REAL session cookies + REAL Postgres + REAL
 * sharp + the REAL DBByte HTTP client talking to a LOCAL fake that mimics the
 * documented DBByte API (auth header, multipart upload, 409 on duplicate,
 * delete). This is NOT a test against the real DBByte service.
 */
const bucket = new Map<string, Buffer>();
let failUploadWith: number | null = null;
let server: http.Server;
const tag = `e2e_${Date.now()}`;
const CDN = "https://cdn.example.test/tok";
let userA = 0;
let userB = 0;
let tokenA = "";
let tokenB = "";
let playlistOfB = 0;
const savedEnv: Record<string, string | undefined> = {};
let seq = 0;

const jpeg = (w = 640, h = 360) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 40, b: 40 } } }).jpeg().toBuffer();
const png = () => sharp({ create: { width: 320, height: 180, channels: 4, background: { r: 0, g: 120, b: 255, alpha: 0.5 } } }).png().toBuffer();
const webp = () => sharp({ create: { width: 320, height: 180, channels: 3, background: { r: 10, g: 200, b: 90 } } }).webp().toBuffer();

function req(path: string, init: { method?: string; token?: string; json?: unknown; form?: FormData; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { host: "localhost", ...(init.headers ?? {}) };
  if (init.token) headers.cookie = `onfile_session=${init.token}`;
  if (init.json !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(`http://localhost${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.form ?? (init.json !== undefined ? JSON.stringify(init.json) : undefined),
  });
}
const uploadForm = (buf: Buffer | Uint8Array, name: string, type: string) => {
  const f = new FormData();
  f.append("file", new File([new Uint8Array(buf)], name, { type }));
  return f;
};
const stage = (token: string | undefined, buf: Buffer | Uint8Array, name = "t.jpg", type = "image/jpeg") =>
  stagePost(req("/api/thumbnails", { method: "POST", token, form: uploadForm(buf, name, type) }));
const ctxRef = (ref: string) => ({ params: Promise.resolve({ ref }) });
const ctxId = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });
const link = () => `https://t.me/c/9900000111/${700 + ++seq}`;
const pubBody = (extra: Record<string, unknown> = {}) => ({
  telegramMessageLink: link(),
  title: "E2E post",
  description: "",
  category: "Other",
  fileType: "document",
  monetization: "free",
  ...extra,
});

beforeAll(async () => {
  server = http.createServer((rq, res) => {
    const url = new URL(rq.url!, "http://x");
    const chunks: Buffer[] = [];
    rq.on("data", (c) => chunks.push(c));
    rq.on("end", async () => {
      const body = Buffer.concat(chunks);
      res.setHeader("Content-Type", "application/json");
      if (rq.headers.authorization !== "Bearer test-key") {
        res.statusCode = 401;
        return res.end('{"error":"Invalid or revoked API key"}');
      }
      const up = url.pathname === "/storage/test-bucket/upload";
      const del = url.pathname.match(/^\/storage\/test-bucket\/delete\/(.+)$/);
      if (rq.method === "POST" && up) {
        if (failUploadWith) {
          res.statusCode = failUploadWith;
          return res.end('{"error":"simulated"}');
        }
        const request = new Request("http://x", { method: "POST", headers: { "content-type": rq.headers["content-type"]! }, body });
        const file = (await request.formData()).get("file") as File;
        if (bucket.has(file.name) && url.searchParams.get("overwrite") !== "true") {
          res.statusCode = 409;
          return res.end('{"error":"exists"}');
        }
        bucket.set(file.name, Buffer.from(await file.arrayBuffer()));
        return res.end(JSON.stringify({ success: true, key: `1_${file.name}`, name: file.name, size: file.size, mimeType: file.type, fileId: "f" }));
      }
      if (rq.method === "DELETE" && del) {
        const name = decodeURIComponent(del[1]);
        if (!bucket.delete(name)) {
          res.statusCode = 404;
          return res.end('{"error":"nf"}');
        }
        return res.end('{"success":true}');
      }
      res.statusCode = 404;
      res.end("{}");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  for (const [k, v] of Object.entries({ DBBYTE_API_KEY: " \"test-key\"\n", DBBYTE_BUCKET: "test-bucket", DBBYTE_CDN_BASE_URL: CDN, DBBYTE_API_BASE_URL: base })) {
    savedEnv[k] = process.env[k];
    process.env[k] = v; // note the sloppy key value: config normalisation must cope with it
  }

  const [a] = await db.insert(users).values({ telegramId: `${tag}_a`, username: "e2e_a" }).returning();
  const [b] = await db.insert(users).values({ telegramId: `${tag}_b`, username: "e2e_b" }).returning();
  userA = a.id;
  userB = b.id;
  await db.insert(channels).values([
    { userId: userA, telegramChannelId: "-1009900000111", channelName: "A", status: "verified", isVerified: true },
    { userId: userB, telegramChannelId: "-1009900000222", channelName: "B", status: "verified", isVerified: true },
  ]);
  tokenA = (await createSession(userA)).token;
  tokenB = (await createSession(userB)).token;
  const [pl] = await db.insert(playlists).values({ userId: userB, title: "B private list" }).returning();
  playlistOfB = pl.id;
});

afterAll(async () => {
  const ids = [userA, userB].filter(Boolean);
  if (ids.length) {
    await db.delete(thumbnailOrphans).where(like(thumbnailOrphans.objectKey, "thumb-%"));
    await db.delete(files).where(inArray(files.userId, ids));
    await db.delete(playlists).where(inArray(playlists.userId, ids));
    await db.delete(sessions).where(inArray(sessions.userId, ids));
    await db.delete(users).where(inArray(users.id, ids)); // channels, thumbnails cascade
  }
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await new Promise<void>((r) => server.close(() => r()));
});

describe("Thumbnail upload (real route + real DB + real sharp + DBByte client vs local fake)", () => {
  it("rejects unauthenticated uploads and stores nothing", async () => {
    const before = bucket.size;
    const res = await stage(undefined, await jpeg());
    expect(res.status).toBe(401);
    expect(bucket.size).toBe(before);
  });

  it.each([
    ["JPEG", () => jpeg(), "a.jpg", "image/jpeg"],
    ["PNG", () => png(), "a.png", "image/png"],
    ["WebP", () => webp(), "a.webp", "image/webp"],
  ])("accepts a valid %s, returns a stable public URL and stores it staged for the user", async (_n, make, name, type) => {
    const res = await stage(tokenA, await make(), name, type);
    expect(res.status).toBe(201);
    const { thumbnail } = await res.json();
    expect(thumbnail.ref).toMatch(/^[a-f0-9]{24}$/);
    expect(thumbnail.url.startsWith(`${CDN}/test-bucket/thumb-${userA}-staged-`)).toBe(true);
    const [row] = await db.select().from(thumbnailUploads).where(eq(thumbnailUploads.ref, thumbnail.ref));
    expect(row).toMatchObject({ userId: userA, status: "staged", provider: "dbbyte" });
    expect(bucket.has(row.objectKey)).toBe(true);
  });

  it("rejects a GIF, a text file disguised as PNG, and an oversized file", async () => {
    const gif = await sharp({ create: { width: 10, height: 10, channels: 3, background: "#fff" } }).gif().toBuffer();
    const r1 = await stage(tokenB, gif, "a.gif", "image/gif");
    expect(r1.status).toBe(415);
    const r2 = await stage(tokenB, Buffer.from("<html>not an image</html>"), "a.png", "image/png");
    expect(r2.status).toBe(415);
    const r3 = await stage(tokenB, Buffer.alloc(4 * 1024 * 1024 + 1024), "big.png", "image/png");
    expect(r3.status).toBe(413);
    expect((await r3.json()).error).toMatch(/4 MB/);
  });

  it("maps a provider authentication failure to a friendly 503, stores no row, and a retry then succeeds", async () => {
    const rowsBefore = (await db.select().from(thumbnailUploads).where(eq(thumbnailUploads.userId, userB))).length;
    failUploadWith = 401;
    const failed = await stage(tokenB, await jpeg());
    failUploadWith = null;
    expect(failed.status).toBe(503);
    expect((await failed.json()).error).toBe("Thumbnail storage is not available right now.");
    expect((await db.select().from(thumbnailUploads).where(eq(thumbnailUploads.userId, userB))).length).toBe(rowsBefore);

    const retry = await stage(tokenB, await jpeg());
    expect(retry.status).toBe(201);
  });

  it("publishes with a thumbnail: links it to the new post, shows it on the public link API, and survives re-reads", async () => {
    const { thumbnail } = await (await stage(tokenA, await jpeg(), "p.jpg")).json();
    const out = await publishPost(dbPublishDeps, userA, pubBody({ thumbnailRef: thumbnail.ref }));
    expect(out.status).toBe(201);
    const file = (out.body as { file: { id: number; smartLinkSlug: string } }).file;

    const [ft] = await db.select().from(fileThumbnails).where(eq(fileThumbnails.fileId, file.id));
    expect(ft.userId).toBe(userA);
    expect(`${CDN}/test-bucket/${encodeURIComponent(ft.objectKey)}`).toBe(thumbnail.url);
    const [staged] = await db.select().from(thumbnailUploads).where(eq(thumbnailUploads.ref, thumbnail.ref));
    expect(staged).toMatchObject({ status: "attached", fileId: file.id });

    const pub = await linkGet(req(`/api/link/${file.smartLinkSlug}`), { params: Promise.resolve({ slug: file.smartLinkSlug }) });
    expect((await pub.json()).file.thumbnailUrl).toBe(thumbnail.url); // "refresh": a brand-new request reads it from the DB
  });

  it("a post published WITHOUT a thumbnail has none (default fallback)", async () => {
    const out = await publishPost(dbPublishDeps, userA, pubBody());
    expect(out.status).toBe(201);
    const file = (out.body as { file: { id: number; smartLinkSlug: string } }).file;
    expect(await db.select().from(fileThumbnails).where(eq(fileThumbnails.fileId, file.id))).toHaveLength(0);
    const pub = await linkGet(req(`/api/link/${file.smartLinkSlug}`), { params: Promise.resolve({ slug: file.smartLinkSlug }) });
    expect((await pub.json()).file.thumbnailUrl).toBeNull();
  });

  it("refuses another creator's ref, a reused ref and a bogus ref — and rolls the post back (no half-published post)", async () => {
    const { thumbnail } = await (await stage(tokenA, await jpeg(), "x.jpg")).json();

    const stolenLink = `https://t.me/c/9900000222/${700 + ++seq}`;
    const stolen = await publishPost(dbPublishDeps, userB, { ...pubBody({ thumbnailRef: thumbnail.ref }), telegramMessageLink: stolenLink });
    expect(stolen).toMatchObject({ status: 400, body: { reason: "validation_failed", fieldErrors: { thumbnail: expect.any(String) } } });
    expect(await db.select().from(files).where(eq(files.telegramMessageLink, stolenLink))).toHaveLength(0);
    expect((await db.select().from(thumbnailUploads).where(eq(thumbnailUploads.ref, thumbnail.ref)))[0].status).toBe("staged");

    expect((await publishPost(dbPublishDeps, userA, pubBody({ thumbnailRef: thumbnail.ref }))).status).toBe(201);
    const reuseLink = link();
    const reused = await publishPost(dbPublishDeps, userA, { ...pubBody({ thumbnailRef: thumbnail.ref }), telegramMessageLink: reuseLink });
    expect(reused.status).toBe(400);
    expect(await db.select().from(files).where(eq(files.telegramMessageLink, reuseLink))).toHaveLength(0);

    const bogus = await publishPost(dbPublishDeps, userA, pubBody({ thumbnailRef: "0".repeat(24) }));
    expect(bogus.status).toBe(400);
    const malformed = await publishPost(dbPublishDeps, userA, pubBody({ thumbnailRef: "https://evil.example/x.png" }));
    expect(malformed.status).toBe(400); // arbitrary URLs are never accepted as a thumbnail
  });

  it("replace/remove: discarding a staged thumbnail deletes its object; attached or foreign ones are never deleted", async () => {
    const first = (await (await stage(tokenA, await jpeg(), "r1.jpg")).json()).thumbnail;
    const second = (await (await stage(tokenA, await png(), "r2.png", "image/png")).json()).thumbnail;
    const keyOf = async (ref: string) => (await db.select().from(thumbnailUploads).where(eq(thumbnailUploads.ref, ref)))[0].objectKey;
    const k1 = await keyOf(first.ref);
    const k2 = await keyOf(second.ref);

    // Another creator cannot discard it.
    const foreign = await stageDelete(req(`/api/thumbnails/${first.ref}`, { method: "DELETE", token: tokenB }), ctxRef(first.ref));
    expect((await foreign.json()).removed).toBe(false);
    expect(bucket.has(k1)).toBe(true);

    // Owner replaces first with second: the first is discarded and removed from storage.
    const mine = await stageDelete(req(`/api/thumbnails/${first.ref}`, { method: "DELETE", token: tokenA }), ctxRef(first.ref));
    expect((await mine.json()).removed).toBe(true);
    expect(bucket.has(k1)).toBe(false);

    // Once the second is attached to a post, DELETE can no longer remove it.
    expect((await publishPost(dbPublishDeps, userA, pubBody({ thumbnailRef: second.ref }))).status).toBe(201);
    const late = await stageDelete(req(`/api/thumbnails/${second.ref}`, { method: "DELETE", token: tokenA }), ctxRef(second.ref));
    expect((await late.json()).removed).toBe(false);
    expect(bucket.has(k2)).toBe(true);

    // Unauthenticated discard is rejected.
    const anon = await stageDelete(req(`/api/thumbnails/${second.ref}`, { method: "DELETE" }), ctxRef(second.ref));
    expect(anon.status).toBe(401);
  });

  it("purges only stale, never-published staged uploads", async () => {
    const stale = (await (await stage(tokenB, await jpeg(), "s.jpg")).json()).thumbnail;
    const [row] = await db.select().from(thumbnailUploads).where(eq(thumbnailUploads.ref, stale.ref));
    const old = new Date(Date.now() - 26 * 60 * 60 * 1000);
    await db.update(thumbnailUploads).set({ createdAt: old }).where(eq(thumbnailUploads.id, row.id));

    // An OLD but attached thumbnail must survive the purge.
    const [attached] = await db.select().from(thumbnailUploads).where(and(eq(thumbnailUploads.userId, userA), eq(thumbnailUploads.status, "attached"))).limit(1);
    await db.update(thumbnailUploads).set({ createdAt: old }).where(eq(thumbnailUploads.id, attached.id));

    const { getThumbnailStorage } = await import("@/lib/thumbnails/storage");
    const { drizzleRepo } = await import("@/lib/thumbnails/repo");
    await purgeStaleStagedThumbnails({ repo: drizzleRepo, storage: getThumbnailStorage() }, new Date(), 50);

    expect((await db.select().from(thumbnailUploads).where(eq(thumbnailUploads.id, row.id)))[0].status).toBe("expired");
    expect(bucket.has(row.objectKey)).toBe(false);
    expect((await db.select().from(thumbnailUploads).where(eq(thumbnailUploads.id, attached.id)))[0].status).toBe("attached");
    expect(bucket.has(attached.objectKey)).toBe(true);
  });
});

describe("Playlists (real routes + real sessions + real Postgres)", () => {
  let playlistA = 0;

  it("rejects unauthenticated create/list", async () => {
    expect((await playlistsPost(req("/api/playlists", { method: "POST", json: { title: "x" } }))).status).toBe(401);
    expect((await playlistsGet(req("/api/playlists"))).status).toBe(401);
  });

  it("validates required fields", async () => {
    const blank = await playlistsPost(req("/api/playlists", { method: "POST", token: tokenA, json: { title: "   " } }));
    expect(blank.status).toBe(400);
    expect((await blank.json()).error).toBe("Playlist title is required.");
    const bad = await playlistsPost(req("/api/playlists", { method: "POST", token: tokenA, json: { title: "ok", starsPrice: -5 } }));
    expect(bad.status).toBe(400);
    const long = await playlistsPost(req("/api/playlists", { method: "POST", token: tokenA, json: { title: "x".repeat(500) } }));
    expect(long.status).toBe(400);
  });

  it("creates a playlist that is persisted, owned by the caller, and never exposes the password hash", async () => {
    const res = await playlistsPost(req("/api/playlists", { method: "POST", token: tokenA, json: { title: "Course A", description: "d", password: "secret", starsPrice: 0 } }));
    expect(res.status).toBe(201);
    const { playlist } = await res.json();
    playlistA = playlist.id;
    expect(playlist).toMatchObject({ title: "Course A", userId: userA, hasPassword: true, totalFiles: 0 });
    expect(playlist.password).toBeUndefined();
    const [row] = await db.select().from(playlists).where(eq(playlists.id, playlistA));
    expect(row.title).toBe("Course A");
    expect(row.password).toBeTruthy();
    expect(row.password).not.toBe("secret");
  });

  it("prevents duplicates from double-taps / parallel requests", async () => {
    const send = () => playlistsPost(req("/api/playlists", { method: "POST", token: tokenA, json: { title: "Double Tap" } }));
    const results = await Promise.all([send(), send(), send()]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 200, 201]);
    const rows = await db.select().from(playlists).where(and(eq(playlists.userId, userA), eq(playlists.title, "Double Tap")));
    expect(rows).toHaveLength(1);
  });

  it("lists only the caller's playlists (a fresh request sees the new one) with live file counts", async () => {
    const list = await (await playlistsGet(req("/api/playlists", { token: tokenA }))).json();
    expect(list.playlists.map((p: { title: string }) => p.title)).toEqual(expect.arrayContaining(["Course A", "Double Tap"]));
    expect(list.playlists.some((p: { id: number }) => p.id === playlistOfB)).toBe(false);
  });

  it("publishes a post into the playlist; it shows in the contents + count, with its thumbnail", async () => {
    const { thumbnail } = await (await stage(tokenA, await jpeg(), "pl.jpg")).json();
    const out = await publishPost(dbPublishDeps, userA, pubBody({ playlistId: playlistA, thumbnailRef: thumbnail.ref }));
    expect(out.status).toBe(201);
    const inside = await db.select().from(files).where(and(eq(files.userId, userA), eq(files.playlistId, playlistA)));
    expect(inside).toHaveLength(1);
    const list = await (await playlistsGet(req("/api/playlists", { token: tokenA }))).json();
    expect(list.playlists.find((p: { id: number }) => p.id === playlistA).totalFiles).toBe(1);
    const [ft] = await db.select().from(fileThumbnails).where(eq(fileThumbnails.fileId, inside[0].id));
    expect(ft).toBeTruthy(); // thumbnail + playlist association both kept
  });

  it("refuses to attach another creator's playlist (publish and edit) and invalid ids", async () => {
    expect((await publishPost(dbPublishDeps, userA, pubBody({ playlistId: playlistOfB }))).status).toBe(400);
    const [mine] = await db.select().from(files).where(and(eq(files.userId, userA), eq(files.playlistId, playlistA)));
    const steal = await filePatch(req(`/api/files/${mine.id}`, { method: "PATCH", token: tokenA, json: { playlistId: playlistOfB } }), ctxId(mine.id));
    expect(steal.status).toBe(400);
    expect((await db.select().from(files).where(eq(files.id, mine.id)))[0].playlistId).toBe(playlistA);
    const invalid = await filePatch(req(`/api/files/${mine.id}`, { method: "PATCH", token: tokenA, json: { playlistId: "abc" } }), ctxId(mine.id));
    expect(invalid.status).toBe(400);
    expect((await publishPost(dbPublishDeps, userA, pubBody({ playlistId: 999999999 }))).status).toBe(400);
  });

  it("editing a post leaves its thumbnail and playlist untouched; removing the playlist association works", async () => {
    const [mine] = await db.select().from(files).where(and(eq(files.userId, userA), eq(files.playlistId, playlistA)));
    const edit = await filePatch(req(`/api/files/${mine.id}`, { method: "PATCH", token: tokenA, json: { title: "Renamed" } }), ctxId(mine.id));
    expect(edit.status).toBe(200);
    const after = (await db.select().from(files).where(eq(files.id, mine.id)))[0];
    expect(after).toMatchObject({ title: "Renamed", playlistId: playlistA });
    expect(await db.select().from(fileThumbnails).where(eq(fileThumbnails.fileId, mine.id))).toHaveLength(1);

    const detach = await filePatch(req(`/api/files/${mine.id}`, { method: "PATCH", token: tokenA, json: { playlistId: null } }), ctxId(mine.id));
    expect(detach.status).toBe(200);
    expect((await db.select().from(files).where(eq(files.id, mine.id)))[0].playlistId).toBeNull();
    await filePatch(req(`/api/files/${mine.id}`, { method: "PATCH", token: tokenA, json: { playlistId: playlistA } }), ctxId(mine.id));
  });

  it("only the owner can edit/delete; deleting keeps the posts (detached) and their thumbnails", async () => {
    const other = await playlistDelete(req(`/api/playlists/${playlistA}`, { method: "DELETE", token: tokenB }), ctxId(playlistA));
    expect(other.status).toBe(404);
    const otherPatch = await playlistPatch(req(`/api/playlists/${playlistA}`, { method: "PATCH", token: tokenB, json: { title: "hijack" } }), ctxId(playlistA));
    expect(otherPatch.status).toBe(404);
    expect((await playlistDelete(req(`/api/playlists/abc`, { method: "DELETE", token: tokenA }), ctxId("abc"))).status).toBe(400);

    const rename = await playlistPatch(req(`/api/playlists/${playlistA}`, { method: "PATCH", token: tokenA, json: { title: "Course A v2" } }), ctxId(playlistA));
    expect((await rename.json()).playlist.title).toBe("Course A v2");
    expect((await playlistPatch(req(`/api/playlists/${playlistA}`, { method: "PATCH", token: tokenA, json: { title: "" } }), ctxId(playlistA))).status).toBe(400);

    const [inPl] = await db.select().from(files).where(eq(files.playlistId, playlistA));
    const del = await playlistDelete(req(`/api/playlists/${playlistA}`, { method: "DELETE", token: tokenA }), ctxId(playlistA));
    expect(del.status).toBe(200);
    const kept = (await db.select().from(files).where(eq(files.id, inPl.id)))[0];
    expect(kept).toBeTruthy();
    expect(kept.playlistId).toBeNull();
    expect(await db.select().from(fileThumbnails).where(eq(fileThumbnails.fileId, inPl.id))).toHaveLength(1);
    expect(await db.select().from(playlists).where(eq(playlists.id, playlistOfB))).toHaveLength(1); // B's data untouched
  });
});
