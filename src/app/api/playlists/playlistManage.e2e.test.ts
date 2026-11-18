import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { channels, files, playlistFiles, playlists, sessions, users } from "@/db/schema";
import { createSession } from "@/lib/auth";
import { POST as playlistsPost } from "./route";
import { POST as membersAdd } from "./[id]/files/route";
import { DELETE as memberRemove } from "./[id]/files/[fileId]/route";
import { PATCH as filePatch } from "../files/[id]/route";

/** REAL handlers + sessions + Postgres: "remove from playlist" safety, file settings validation. */
const tag = `pm_${Date.now()}`;
let userA = 0;
let userB = 0;
let tokenA = "";
let tokenB = "";
let seq = 0;

const ctx = (id: number | string, fileId?: number | string) => ({ params: Promise.resolve({ id: String(id), fileId: String(fileId ?? 0) }) });
function req(p: string, init: { method?: string; token?: string; json?: unknown } = {}) {
  const headers: Record<string, string> = { host: "localhost" };
  if (init.token) headers.cookie = `onfile_session=${init.token}`;
  if (init.json !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(`http://localhost${p}`, { method: init.method ?? "GET", headers, body: init.json !== undefined ? JSON.stringify(init.json) : undefined });
}
async function makeFile(userId: number, title: string, extra: Partial<typeof files.$inferInsert> = {}) {
  const [f] = await db
    .insert(files)
    .values({ userId, title, fileType: "document", telegramMessageLink: `https://t.me/c/88${userId}/${++seq}`, smartLinkSlug: `${tag}-${seq}`, isPublished: true, ...extra })
    .returning();
  return f;
}
async function makePlaylist(token: string, title: string) {
  const res = await playlistsPost(req("/api/playlists", { method: "POST", token, json: { title } }));
  expect(res.status).toBe(201);
  return (await res.json()).playlist as { id: number };
}

beforeAll(async () => {
  const [a] = await db.insert(users).values({ telegramId: `${tag}_a`, username: "pm_a" }).returning();
  const [b] = await db.insert(users).values({ telegramId: `${tag}_b`, username: "pm_b" }).returning();
  userA = a.id;
  userB = b.id;
  await db.insert(channels).values([
    { userId: userA, telegramChannelId: "-1008800000001", channelName: "A", status: "verified", isVerified: true },
    { userId: userB, telegramChannelId: "-1008800000002", channelName: "B", status: "verified", isVerified: true },
  ]);
  tokenA = (await createSession(userA)).token;
  tokenB = (await createSession(userB)).token;
});

afterAll(async () => {
  const ids = [userA, userB].filter(Boolean);
  if (ids.length) {
    await db.delete(files).where(inArray(files.userId, ids));
    await db.delete(playlists).where(inArray(playlists.userId, ids));
    await db.delete(sessions).where(inArray(sessions.userId, ids));
    await db.delete(users).where(inArray(users.id, ids));
  }
});

describe("Remove from playlist keeps everything else", () => {
  it("only deletes the membership: the file, its link and its other playlists are untouched", async () => {
    const p1 = await makePlaylist(tokenA, "P one");
    const p2 = await makePlaylist(tokenA, "P two");
    const f = await makeFile(userA, "shared file");
    for (const p of [p1, p2]) await membersAdd(req(`/api/playlists/${p.id}/files`, { method: "POST", token: tokenA, json: { fileIds: [f.id] } }), ctx(p.id));

    const res = await memberRemove(req(`/api/playlists/${p1.id}/files/${f.id}`, { method: "DELETE", token: tokenA }), ctx(p1.id, f.id));
    expect(res.status).toBe(200);

    const [row] = await db.select().from(files).where(eq(files.id, f.id));
    expect(row).toMatchObject({ isPublished: true, smartLinkSlug: f.smartLinkSlug, telegramMessageLink: f.telegramMessageLink });
    const memberships = await db.select().from(playlistFiles).where(eq(playlistFiles.fileId, f.id));
    expect(memberships.map((m) => m.playlistId)).toEqual([p2.id]);
  });

  it("another creator cannot remove from, or add to, this playlist", async () => {
    const p = await makePlaylist(tokenA, "Mine");
    const f = await makeFile(userA, "mine");
    await membersAdd(req(`/api/playlists/${p.id}/files`, { method: "POST", token: tokenA, json: { fileIds: [f.id] } }), ctx(p.id));
    const del = await memberRemove(req(`/api/playlists/${p.id}/files/${f.id}`, { method: "DELETE", token: tokenB }), ctx(p.id, f.id));
    expect(del.status).toBe(404);
    const fB = await makeFile(userB, "theirs");
    const add = await membersAdd(req(`/api/playlists/${p.id}/files`, { method: "POST", token: tokenB, json: { fileIds: [fB.id] } }), ctx(p.id));
    expect(add.status).toBe(404);
    const stillThere = await db.select().from(playlistFiles).where(eq(playlistFiles.playlistId, p.id));
    expect(stillThere).toHaveLength(1);
  });
});

describe("PATCH /api/files/:id (publish / settings)", () => {
  const patch = (token: string | undefined, id: number, json: unknown) => filePatch(req(`/api/files/${id}`, { method: "PATCH", token, json }), ctx(id));

  it("unpublish / publish only toggles the flag — the file is never deleted", async () => {
    const f = await makeFile(userA, "toggle");
    expect((await patch(tokenA, f.id, { isPublished: false })).status).toBe(200);
    expect((await db.select().from(files).where(eq(files.id, f.id)))[0]).toMatchObject({ isPublished: false, smartLinkSlug: f.smartLinkSlug });
    expect((await patch(tokenA, f.id, { isPublished: true })).status).toBe(200);
    expect((await db.select().from(files).where(eq(files.id, f.id)))[0].isPublished).toBe(true);
  });

  it("validates title, Stars price and publish flag, and keeps other creators out", async () => {
    const f = await makeFile(userA, "valid");
    expect((await patch(tokenA, f.id, { title: "  " })).status).toBe(400);
    expect((await patch(tokenA, f.id, { starsPrice: -1 })).status).toBe(400);
    expect((await patch(tokenA, f.id, { starsPrice: 1.5 })).status).toBe(400);
    expect((await patch(tokenA, f.id, { starsPrice: 99999999 })).status).toBe(400);
    expect((await patch(tokenA, f.id, { isPublished: "yes" })).status).toBe(400);
    const ok = await patch(tokenA, f.id, { title: " New title ", starsPrice: 25 });
    expect(ok.status).toBe(200);
    expect((await ok.json()).file).toMatchObject({ title: "New title", starsPrice: 25 });
    expect((await patch(tokenB, f.id, { title: "hijack" })).status).toBe(404);
    expect((await patch(undefined, f.id, { title: "anon" })).status).toBe(401);
    expect((await db.select().from(files).where(eq(files.id, f.id)))[0].title).toBe("New title");
  });
});
