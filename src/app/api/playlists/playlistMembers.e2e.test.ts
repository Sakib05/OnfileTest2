import fs from "fs";
import path from "path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { channels, fileThumbnails, files, playlistFiles, playlists, sessions, users } from "@/db/schema";
import { createSession } from "@/lib/auth";
import { GET as playlistsGet, POST as playlistsPost } from "./route";
import { DELETE as playlistDelete, PATCH as playlistPatch } from "./[id]/route";
import { GET as membersGet, POST as membersAdd, PUT as membersReorder } from "./[id]/files/route";
import { DELETE as memberRemove } from "./[id]/files/[fileId]/route";
import { POST as memberTransfer } from "./[id]/files/[fileId]/transfer/route";
import { GET as libraryGet } from "../files/route";

/**
 * End-to-end: REAL route handlers + REAL session cookies + REAL Postgres.
 * Covers playlist editing, add / remove / reorder / transfer, multi-membership,
 * derived covers, safe deletion, ownership enforcement and the migration SQL.
 */
const tag = `pl_${Date.now()}`;
const CDN = "https://cdn.example.test/tok";
let userA = 0;
let userB = 0;
let tokenA = "";
let tokenB = "";
const savedEnv: Record<string, string | undefined> = {};
let seq = 0;

const ctx = (id: number | string, fileId?: number | string) => ({ params: Promise.resolve({ id: String(id), fileId: String(fileId ?? 0) }) });

function req(p: string, init: { method?: string; token?: string; json?: unknown } = {}) {
  const headers: Record<string, string> = { host: "localhost" };
  if (init.token) headers.cookie = `onfile_session=${init.token}`;
  if (init.json !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(`http://localhost${p}`, { method: init.method ?? "GET", headers, body: init.json !== undefined ? JSON.stringify(init.json) : undefined });
}

async function makeFile(userId: number, title: string, thumb = false, extra: Partial<typeof files.$inferInsert> = {}) {
  const [f] = await db
    .insert(files)
    .values({ userId, title, fileType: "document", telegramMessageLink: `https://t.me/c/77${userId}/${++seq}`, smartLinkSlug: `${tag}-${seq}`, isPublished: true, ...extra })
    .returning();
  if (thumb) {
    await db.insert(fileThumbnails).values({
      userId,
      fileId: f.id,
      objectKey: `thumb-${tag}-${f.id}.webp`,
      version: "v1",
      mimeType: "image/webp",
      format: "webp",
      sizeBytes: 1000,
      width: 640,
      height: 360,
    });
  }
  return f;
}

async function makePlaylist(token: string, title: string, description?: string) {
  const res = await playlistsPost(req("/api/playlists", { method: "POST", token, json: { title, description } }));
  expect(res.status).toBe(201);
  return (await res.json()).playlist as { id: number; title: string; description: string | null; thumbnailUrl: string | null; totalFiles: number };
}

const add = (token: string | undefined, pid: number, fileIds: unknown) => membersAdd(req(`/api/playlists/${pid}/files`, { method: "POST", token, json: { fileIds } }), ctx(pid));
const reorder = (token: string | undefined, pid: number, fileIds: unknown) => membersReorder(req(`/api/playlists/${pid}/files`, { method: "PUT", token, json: { fileIds } }), ctx(pid));
const remove = (token: string | undefined, pid: number, fid: number) => memberRemove(req(`/api/playlists/${pid}/files/${fid}`, { method: "DELETE", token }), ctx(pid, fid));
const transfer = (token: string | undefined, from: number, fid: number, body: unknown) =>
  memberTransfer(req(`/api/playlists/${from}/files/${fid}/transfer`, { method: "POST", token, json: body }), ctx(from, fid));
const contents = async (token: string, pid: number) => {
  const res = await membersGet(req(`/api/playlists/${pid}/files`, { token }), ctx(pid));
  expect(res.status).toBe(200);
  return ((await res.json()).files as { id: number; title: string; thumbnailUrl: string | null }[]);
};
const listPlaylist = async (token: string, pid: number) => {
  const res = await playlistsGet(req("/api/playlists", { token }));
  return ((await res.json()).playlists as { id: number; title: string; totalFiles: number; thumbnailUrl: string | null }[]).find((p) => p.id === pid);
};
const thumbUrl = (fileId: number) => `${CDN}/test-bucket/thumb-${tag}-${fileId}.webp`;

beforeAll(async () => {
  for (const [k, v] of Object.entries({ DBBYTE_API_KEY: "k", DBBYTE_BUCKET: "test-bucket", DBBYTE_CDN_BASE_URL: CDN })) {
    savedEnv[k] = process.env[k];
    process.env[k] = v;
  }
  const [a] = await db.insert(users).values({ telegramId: `${tag}_a`, username: "pl_a" }).returning();
  const [b] = await db.insert(users).values({ telegramId: `${tag}_b`, username: "pl_b" }).returning();
  userA = a.id;
  userB = b.id;
  await db.insert(channels).values([
    { userId: userA, telegramChannelId: "-1007700000001", channelName: "A", status: "verified", isVerified: true },
    { userId: userB, telegramChannelId: "-1007700000002", channelName: "B", status: "verified", isVerified: true },
  ]);
  tokenA = (await createSession(userA)).token;
  tokenB = (await createSession(userB)).token;
});

afterAll(async () => {
  const ids = [userA, userB].filter(Boolean);
  if (ids.length) {
    await db.delete(files).where(inArray(files.userId, ids)); // cascades memberships + thumbnails
    await db.delete(playlists).where(inArray(playlists.userId, ids));
    await db.delete(sessions).where(inArray(sessions.userId, ids));
    await db.delete(users).where(inArray(users.id, ids));
  }
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("edit playlist information", () => {
  it("renames and edits the description; the new values are returned and persisted", async () => {
    const pl = await makePlaylist(tokenA, "Accounting Course", "old");
    const res = await playlistPatch(req(`/api/playlists/${pl.id}`, { method: "PATCH", token: tokenA, json: { title: "  Accounting 101 ", description: "New description" } }), ctx(pl.id));
    expect(res.status).toBe(200);
    const body = (await res.json()).playlist;
    expect(body).toMatchObject({ title: "Accounting 101", description: "New description" });
    const [row] = await db.select().from(playlists).where(eq(playlists.id, pl.id));
    expect(row).toMatchObject({ title: "Accounting 101", description: "New description" });
    expect((await listPlaylist(tokenA, pl.id))?.title).toBe("Accounting 101");

    const cleared = await playlistPatch(req(`/api/playlists/${pl.id}`, { method: "PATCH", token: tokenA, json: { description: "" } }), ctx(pl.id));
    expect((await cleared.json()).playlist.description).toBeNull();
    const empty = await playlistPatch(req(`/api/playlists/${pl.id}`, { method: "PATCH", token: tokenA, json: { title: "   " } }), ctx(pl.id));
    expect(empty.status).toBe(400);
  });
});

describe("add / duplicate / remove", () => {
  it("adds one file, then several, in order; duplicates are skipped and never stored twice", async () => {
    const pl = await makePlaylist(tokenA, "Add test");
    const [f1, f2, f3, f4] = [await makeFile(userA, "One.pdf"), await makeFile(userA, "Two.pdf"), await makeFile(userA, "Three.pdf"), await makeFile(userA, "Four.pdf")];

    const one = await add(tokenA, pl.id, [f1.id]);
    expect(one.status).toBe(200);
    expect((await one.json()).added).toEqual([f1.id]);

    const many = await add(tokenA, pl.id, [f2.id, f3.id]);
    expect((await many.json()).added).toEqual([f2.id, f3.id]);
    expect((await contents(tokenA, pl.id)).map((f) => f.id)).toEqual([f1.id, f2.id, f3.id]);

    const dup = await (await add(tokenA, pl.id, [f2.id, f4.id])).json();
    expect(dup.added).toEqual([f4.id]);
    expect(dup.alreadyMembers).toEqual([f2.id]);
    expect(dup.playlist.totalFiles).toBe(4);
    expect(await db.select().from(playlistFiles).where(and(eq(playlistFiles.playlistId, pl.id), eq(playlistFiles.fileId, f2.id)))).toHaveLength(1);

    // two simultaneous identical requests still produce one row (unique index + row lock)
    const f5 = await makeFile(userA, "Five.pdf");
    await Promise.all([add(tokenA, pl.id, [f5.id]), add(tokenA, pl.id, [f5.id])]);
    expect(await db.select().from(playlistFiles).where(and(eq(playlistFiles.playlistId, pl.id), eq(playlistFiles.fileId, f5.id)))).toHaveLength(1);
  });

  it("many concurrent adds keep positions unique and contiguous", async () => {
    const pl = await makePlaylist(tokenA, "Concurrent adds");
    const fs_ = await Promise.all(Array.from({ length: 6 }, (_, i) => makeFile(userA, `C${i}`)));
    const results = await Promise.all(fs_.map((f) => add(tokenA, pl.id, [f.id])));
    expect(results.every((r) => r.status === 200)).toBe(true);
    const rows = await db.select().from(playlistFiles).where(eq(playlistFiles.playlistId, pl.id));
    expect(rows.map((r) => r.position).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("removing a file only removes the membership: the file stays in the Library and in other playlists", async () => {
    const p1 = await makePlaylist(tokenA, "Keep 1");
    const p2 = await makePlaylist(tokenA, "Keep 2");
    const f = await makeFile(userA, "Shared.pdf", true);
    await add(tokenA, p1.id, [f.id]);
    await add(tokenA, p2.id, [f.id]);

    const res = await remove(tokenA, p1.id, f.id);
    expect(res.status).toBe(200);
    expect(await contents(tokenA, p1.id)).toHaveLength(0);
    expect((await contents(tokenA, p2.id)).map((x) => x.id)).toEqual([f.id]); // other playlist unaffected
    expect(await db.select().from(files).where(eq(files.id, f.id))).toHaveLength(1);
    expect(await db.select().from(fileThumbnails).where(eq(fileThumbnails.fileId, f.id))).toHaveLength(1);
    const lib = (await (await libraryGet(req("/api/files", { token: tokenA }))).json()).files as { id: number }[];
    expect(lib.some((x) => x.id === f.id)).toBe(true);

    expect((await remove(tokenA, p1.id, f.id)).status).toBe(404); // no longer a member
  });
});

describe("multiple memberships", () => {
  it("the same original file can be in several playlists simultaneously (one files row)", async () => {
    const f = await makeFile(userA, "Introduction to Accounting.pdf");
    const names = ["Accounting Course", "BBA Study Materials", "Exam Preparation"];
    const pls = [];
    for (const n of names) {
      const pl = await makePlaylist(tokenA, `${tag} ${n}`);
      expect((await add(tokenA, pl.id, [f.id])).status).toBe(200);
      pls.push(pl);
    }
    for (const pl of pls) expect((await contents(tokenA, pl.id)).map((x) => x.id)).toEqual([f.id]);
    expect(await db.select().from(files).where(eq(files.title, "Introduction to Accounting.pdf"))).toHaveLength(1);
    expect(await db.select().from(playlistFiles).where(eq(playlistFiles.fileId, f.id))).toHaveLength(3);
  });
});

describe("reorder", () => {
  it("persists a new order, survives a refresh, and rejects stale or foreign id lists", async () => {
    const pl = await makePlaylist(tokenA, "Reorder");
    const fs_ = [await makeFile(userA, "R1"), await makeFile(userA, "R2"), await makeFile(userA, "R3")];
    await add(tokenA, pl.id, fs_.map((f) => f.id));

    const newOrder = [fs_[2].id, fs_[0].id, fs_[1].id];
    const res = await reorder(tokenA, pl.id, newOrder);
    expect(res.status).toBe(200);
    expect((await res.json()).files.map((f: { id: number }) => f.id)).toEqual(newOrder);
    // "refresh": brand-new request reading from the database
    expect((await contents(tokenA, pl.id)).map((f) => f.id)).toEqual(newOrder);
    const rows = await db.select().from(playlistFiles).where(eq(playlistFiles.playlistId, pl.id));
    expect(rows.sort((a, b) => a.position - b.position).map((r) => r.fileId)).toEqual(newOrder);

    expect((await reorder(tokenA, pl.id, [fs_[0].id, fs_[1].id])).status).toBe(409); // missing one
    expect((await reorder(tokenA, pl.id, [...newOrder, 999999])).status).toBe(409); // extra id
    const foreign = await makeFile(userB, "B file");
    expect((await reorder(tokenA, pl.id, [newOrder[0], newOrder[1], foreign.id])).status).toBe(409);
    expect((await reorder(tokenA, pl.id, [newOrder[0], newOrder[0], newOrder[1]])).status).toBe(400); // duplicates
    expect((await reorder(tokenA, pl.id, [])).status).toBe(400);
    expect((await contents(tokenA, pl.id)).map((f) => f.id)).toEqual(newOrder); // unchanged by the failures
  });
});

describe("automatic playlist thumbnail (first file)", () => {
  it("follows the first file through add, reorder, removal, emptiness and a missing thumbnail", async () => {
    const pl = await makePlaylist(tokenA, "Cover");
    expect(pl.thumbnailUrl).toBeNull(); // empty → default image

    const a = await makeFile(userA, "A", true);
    const b = await makeFile(userA, "B", true);
    const c = await makeFile(userA, "C", false); // no thumbnail

    await add(tokenA, pl.id, [a.id]);
    expect((await listPlaylist(tokenA, pl.id))?.thumbnailUrl).toBe(thumbUrl(a.id)); // 1. first file added

    await add(tokenA, pl.id, [b.id, c.id]);
    expect((await listPlaylist(tokenA, pl.id))?.thumbnailUrl).toBe(thumbUrl(a.id));

    await reorder(tokenA, pl.id, [b.id, a.id, c.id]);
    expect((await listPlaylist(tokenA, pl.id))?.thumbnailUrl).toBe(thumbUrl(b.id)); // 2. reorder

    await remove(tokenA, pl.id, b.id);
    expect((await listPlaylist(tokenA, pl.id))?.thumbnailUrl).toBe(thumbUrl(a.id)); // 3. first removed → next

    await reorder(tokenA, pl.id, [c.id, a.id]);
    expect((await listPlaylist(tokenA, pl.id))?.thumbnailUrl).toBeNull(); // 5. first has none → default (NOT the next file's)

    await remove(tokenA, pl.id, c.id);
    await remove(tokenA, pl.id, a.id);
    expect((await listPlaylist(tokenA, pl.id))?.thumbnailUrl).toBeNull(); // 4. empty → default
    expect(await db.select().from(playlistFiles).where(eq(playlistFiles.playlistId, pl.id))).toHaveLength(0);
    // the thumbnails themselves were never touched or duplicated
    expect(await db.select().from(fileThumbnails).where(inArray(fileThumbnails.fileId, [a.id, b.id]))).toHaveLength(2);
  });

  it("the replacement of a file's own thumbnail is reflected by its playlists (derived, never stored)", async () => {
    const pl = await makePlaylist(tokenA, "Cover live");
    const a = await makeFile(userA, "Live", true);
    await add(tokenA, pl.id, [a.id]);
    await db.update(fileThumbnails).set({ objectKey: `thumb-${tag}-${a.id}-v2.webp` }).where(eq(fileThumbnails.fileId, a.id));
    expect((await listPlaylist(tokenA, pl.id))?.thumbnailUrl).toBe(`${CDN}/test-bucket/thumb-${tag}-${a.id}-v2.webp`);
    const [row] = await db.select().from(playlists).where(eq(playlists.id, pl.id));
    expect(row.coverUrl).toBeNull(); // no playlist-level image is stored
  });
});

describe("add to / move to another playlist", () => {
  it("add keeps the file in the source; move removes it from the source; both keep the original", async () => {
    const src = await makePlaylist(tokenA, "Source");
    const dst = await makePlaylist(tokenA, "Dest");
    const f1 = await makeFile(userA, "T1");
    const f2 = await makeFile(userA, "T2");
    const f3 = await makeFile(userA, "T3");
    await add(tokenA, src.id, [f1.id, f2.id, f3.id]);

    const addRes = await transfer(tokenA, src.id, f1.id, { toPlaylistId: dst.id, mode: "add" });
    expect(addRes.status).toBe(200);
    expect((await contents(tokenA, src.id)).map((f) => f.id)).toEqual([f1.id, f2.id, f3.id]);
    expect((await contents(tokenA, dst.id)).map((f) => f.id)).toEqual([f1.id]);

    const moveRes = await transfer(tokenA, src.id, f2.id, { toPlaylistId: dst.id, mode: "move" });
    expect(moveRes.status).toBe(200);
    expect((await moveRes.json()).mode).toBe("move");
    expect((await contents(tokenA, src.id)).map((f) => f.id)).toEqual([f1.id, f3.id]);
    expect((await contents(tokenA, dst.id)).map((f) => f.id)).toEqual([f1.id, f2.id]);

    // moving a file that the destination already has just leaves the source
    const again = await transfer(tokenA, src.id, f1.id, { toPlaylistId: dst.id, mode: "move" });
    expect((await again.json()).alreadyInDestination).toBe(true);
    expect((await contents(tokenA, src.id)).map((f) => f.id)).toEqual([f3.id]);
    expect(await db.select().from(playlistFiles).where(and(eq(playlistFiles.playlistId, dst.id), eq(playlistFiles.fileId, f1.id)))).toHaveLength(1);

    for (const f of [f1, f2, f3]) expect(await db.select().from(files).where(eq(files.id, f.id))).toHaveLength(1);

    expect((await transfer(tokenA, src.id, f3.id, { toPlaylistId: src.id, mode: "move" })).status).toBe(400); // same playlist
    expect((await transfer(tokenA, src.id, f3.id, { toPlaylistId: dst.id, mode: "copy" })).status).toBe(400); // bad mode
    expect((await transfer(tokenA, src.id, f1.id, { toPlaylistId: dst.id, mode: "add" })).status).toBe(404); // f1 no longer in source
    expect((await transfer(tokenA, src.id, f3.id, { toPlaylistId: 999999999, mode: "add" })).status).toBe(404);
  });

  it("a failed move leaves BOTH playlists unchanged (atomic)", async () => {
    const src = await makePlaylist(tokenA, "Atomic src");
    const f = await makeFile(userA, "Atomic");
    await add(tokenA, src.id, [f.id]);
    const res = await transfer(tokenA, src.id, f.id, { toPlaylistId: 2147483000, mode: "move" });
    expect(res.status).toBe(404);
    expect((await contents(tokenA, src.id)).map((x) => x.id)).toEqual([f.id]);
  });
});

describe("delete playlist safely", () => {
  it("deleting an empty playlist works", async () => {
    const pl = await makePlaylist(tokenA, "Empty to delete");
    const res = await playlistDelete(req(`/api/playlists/${pl.id}`, { method: "DELETE", token: tokenA }), ctx(pl.id));
    expect(res.status).toBe(200);
    expect(await db.select().from(playlists).where(eq(playlists.id, pl.id))).toHaveLength(0);
  });

  it("deleting a playlist with files removes only the playlist + memberships; files and other playlists are untouched", async () => {
    const doomed = await makePlaylist(tokenA, "Doomed");
    const survivor = await makePlaylist(tokenA, "Survivor");
    const f1 = await makeFile(userA, "D1", true);
    const f2 = await makeFile(userA, "D2");
    await add(tokenA, doomed.id, [f1.id, f2.id]);
    await add(tokenA, survivor.id, [f1.id]);

    const res = await playlistDelete(req(`/api/playlists/${doomed.id}`, { method: "DELETE", token: tokenA }), ctx(doomed.id));
    expect(res.status).toBe(200);
    expect((await res.json()).detachedFiles).toBe(2);

    expect(await db.select().from(playlists).where(eq(playlists.id, doomed.id))).toHaveLength(0);
    expect(await db.select().from(playlistFiles).where(eq(playlistFiles.playlistId, doomed.id))).toHaveLength(0);
    for (const f of [f1, f2]) expect(await db.select().from(files).where(eq(files.id, f.id))).toHaveLength(1);
    expect(await db.select().from(fileThumbnails).where(eq(fileThumbnails.fileId, f1.id))).toHaveLength(1);
    expect((await contents(tokenA, survivor.id)).map((f) => f.id)).toEqual([f1.id]);
    const lib = (await (await libraryGet(req("/api/files", { token: tokenA }))).json()).files as { id: number }[];
    expect(lib.map((x) => x.id)).toEqual(expect.arrayContaining([f1.id, f2.id]));
  });
});

describe("authorization", () => {
  it("rejects unauthenticated requests", async () => {
    const pl = await makePlaylist(tokenA, "Auth");
    const f = await makeFile(userA, "AuthFile");
    expect((await add(undefined, pl.id, [f.id])).status).toBe(401);
    expect((await reorder(undefined, pl.id, [f.id])).status).toBe(401);
    expect((await remove(undefined, pl.id, f.id)).status).toBe(401);
    expect((await transfer(undefined, pl.id, f.id, { toPlaylistId: 1, mode: "add" })).status).toBe(401);
    expect((await membersGet(req(`/api/playlists/${pl.id}/files`), ctx(pl.id))).status).toBe(401);
  });

  it("another creator cannot read or change my playlists, and cannot use my files", async () => {
    const mine = await makePlaylist(tokenA, "Mine");
    const myFile = await makeFile(userA, "My file");
    await add(tokenA, mine.id, [myFile.id]);
    const theirs = await makePlaylist(tokenB, "Theirs");
    const theirFile = await makeFile(userB, "Their file");

    // B → A's playlist
    expect((await membersGet(req(`/api/playlists/${mine.id}/files`, { token: tokenB }), ctx(mine.id))).status).toBe(404);
    expect((await add(tokenB, mine.id, [theirFile.id])).status).toBe(404);
    expect((await reorder(tokenB, mine.id, [myFile.id])).status).toBe(404);
    expect((await remove(tokenB, mine.id, myFile.id)).status).toBe(404);
    expect((await transfer(tokenB, mine.id, myFile.id, { toPlaylistId: theirs.id, mode: "move" })).status).toBe(404);
    expect((await playlistPatch(req(`/api/playlists/${mine.id}`, { method: "PATCH", token: tokenB, json: { title: "hijack" } }), ctx(mine.id))).status).toBe(404);
    expect((await playlistDelete(req(`/api/playlists/${mine.id}`, { method: "DELETE", token: tokenB }), ctx(mine.id))).status).toBe(404);

    // B → A's file in B's own playlist, and B's file moved into A's playlist
    expect((await add(tokenB, theirs.id, [myFile.id])).status).toBe(404);
    expect((await add(tokenB, theirs.id, [theirFile.id, myFile.id])).status).toBe(404); // all-or-nothing
    expect(await contents(tokenB, theirs.id)).toHaveLength(0);
    await add(tokenB, theirs.id, [theirFile.id]);
    expect((await transfer(tokenB, theirs.id, theirFile.id, { toPlaylistId: mine.id, mode: "add" })).status).toBe(404);
    expect(await db.select().from(playlistFiles).where(eq(playlistFiles.playlistId, mine.id))).toHaveLength(1);

    // A's data is exactly as it was
    expect((await contents(tokenA, mine.id)).map((f) => f.id)).toEqual([myFile.id]);
    expect((await listPlaylist(tokenA, mine.id))?.title).toBe("Mine");
  });

  it("ignores a client-supplied userId in the body", async () => {
    const mine = await makePlaylist(tokenA, "Spoof");
    const theirFile = await makeFile(userB, "Spoof file");
    const res = await membersAdd(req(`/api/playlists/${mine.id}/files`, { method: "POST", token: tokenA, json: { fileIds: [theirFile.id], userId: userB } }), ctx(mine.id));
    expect(res.status).toBe(404);
  });

  it("rejects cross-origin mutations (CSRF)", async () => {
    const pl = await makePlaylist(tokenA, "CSRF");
    const f = await makeFile(userA, "CSRF file");
    const r = new NextRequest(`http://localhost/api/playlists/${pl.id}/files`, {
      method: "POST",
      headers: { host: "localhost", origin: "https://evil.example", cookie: `onfile_session=${tokenA}`, "content-type": "application/json" },
      body: JSON.stringify({ fileIds: [f.id] }),
    });
    expect((await membersAdd(r, ctx(pl.id))).status).toBe(403);
    expect(await contents(tokenA, pl.id)).toHaveLength(0);
  });

  it("validates ids and payload shape", async () => {
    const pl = await makePlaylist(tokenA, "Validate");
    expect((await add(tokenA, pl.id, "nope")).status).toBe(400);
    expect((await add(tokenA, pl.id, [1.5])).status).toBe(400);
    expect((await add(tokenA, pl.id, [-1])).status).toBe(400);
    expect((await add(tokenA, pl.id, Array.from({ length: 201 }, (_, i) => i + 1))).status).toBe(400);
    expect((await membersGet(req(`/api/playlists/abc/files`, { token: tokenA }), ctx("abc"))).status).toBe(400);
  });
});

describe("legacy data + migration", () => {
  it("a file linked through the legacy files.playlist_id column shows up (self-healing backfill) and stays removable", async () => {
    const pl = await makePlaylist(tokenA, "Legacy");
    const legacy = await makeFile(userA, "Legacy file", true, { playlistId: pl.id });
    expect(await db.select().from(playlistFiles).where(eq(playlistFiles.fileId, legacy.id))).toHaveLength(0);

    const listed = await listPlaylist(tokenA, pl.id);
    expect(listed?.totalFiles).toBe(1);
    expect(listed?.thumbnailUrl).toBe(thumbUrl(legacy.id));
    expect((await contents(tokenA, pl.id)).map((f) => f.id)).toEqual([legacy.id]);

    expect((await remove(tokenA, pl.id, legacy.id)).status).toBe(200);
    expect(await contents(tokenA, pl.id)).toHaveLength(0); // the backfill must not resurrect it
    expect(await listPlaylist(tokenA, pl.id)).toMatchObject({ totalFiles: 0, thumbnailUrl: null });
    expect(await db.select().from(files).where(eq(files.id, legacy.id))).toHaveLength(1);
  });

  it("migrations/playlist_files/up.sql is idempotent and backfills without altering files; down.sql only drops the new table", async () => {
    const pl = await makePlaylist(tokenA, "Migrate");
    const f1 = await makeFile(userA, "M1", false, { playlistId: pl.id });
    const f2 = await makeFile(userA, "M2", false, { playlistId: pl.id });
    const up = fs.readFileSync(path.join(process.cwd(), "migrations/playlist_files/up.sql"), "utf8");
    const before = await db.select().from(files).where(inArray(files.id, [f1.id, f2.id]));

    await db.execute(sql.raw(up));
    await db.execute(sql.raw(up)); // run twice
    const rows = await db.select().from(playlistFiles).where(eq(playlistFiles.playlistId, pl.id));
    expect(rows.sort((a, b) => a.position - b.position).map((r) => r.fileId)).toEqual([f1.id, f2.id]); // oldest first
    const after = await db.select().from(files).where(inArray(files.id, [f1.id, f2.id]));
    expect(after).toEqual(before); // files table untouched
    expect(fs.readFileSync(path.join(process.cwd(), "migrations/playlist_files/down.sql"), "utf8")).toMatch(/DROP TABLE IF EXISTS "playlist_files"/);
  });
});
