import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { files, playlistFiles, playlists, sessions, users } from "@/db/schema";
import { createSession } from "@/lib/auth";
import { GET as libraryGet } from "./route";
import { DELETE as fileDelete, PATCH as filePatch } from "./[id]/route";
import { GET as filePlaylists } from "./[id]/playlists/route";
import { POST as membersAdd } from "../playlists/[id]/files/route";
import { DELETE as memberRemove } from "../playlists/[id]/files/[fileId]/route";

/**
 * Library file actions end-to-end: REAL route handlers + REAL session cookies + REAL Postgres.
 * Covers Edit Details (PATCH), Manage Playlists (membership read + existing add/remove), Delete File safety,
 * ownership, and that the Library listing never leaks Telegram links / the password hash.
 */
const tag = `lib_${Date.now()}`;
let userA = 0;
let userB = 0;
let tokenA = "";
let tokenB = "";
let seq = 0;
const ctx = (id: number | string, fileId?: number | string) => ({ params: Promise.resolve({ id: String(id), fileId: String(fileId ?? 0) }) });

function req(p: string, init: { method?: string; token?: string; json?: unknown; raw?: string } = {}) {
  const headers: Record<string, string> = { host: "localhost" };
  if (init.token) headers.cookie = `onfile_session=${init.token}`;
  if (init.json !== undefined || init.raw !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(`http://localhost${p}`, { method: init.method ?? "GET", headers, body: init.raw ?? (init.json !== undefined ? JSON.stringify(init.json) : undefined) });
}
async function makeFile(userId: number, title: string, extra: Partial<typeof files.$inferInsert> = {}) {
  const [f] = await db
    .insert(files)
    .values({ userId, title, fileType: "document", telegramMessageLink: `https://t.me/c/99${userId}/${++seq}`, telegramFileId: `tgfile-${tag}-${seq}`, smartLinkSlug: `${tag}-${seq}`, isPublished: true, ...extra })
    .returning();
  return f;
}
async function makePlaylist(userId: number, title: string, isPublished = true) {
  const [p] = await db.insert(playlists).values({ userId, title, isPublished }).returning();
  return p;
}
const memberships = async (token: string | undefined, fileId: number) => {
  const res = await filePlaylists(req(`/api/files/${fileId}/playlists`, { token }), ctx(fileId));
  return { status: res.status, body: (await res.json()) as { playlists?: { id: number; title: string; isMember: boolean; fileCount: number; isPublished: boolean }[] } };
};
const patch = (token: string | undefined, id: number, json: unknown) => filePatch(req(`/api/files/${id}`, { method: "PATCH", token, json }), ctx(id));

beforeAll(async () => {
  const [a] = await db.insert(users).values({ telegramId: `${tag}_a`, username: "lib_a" }).returning();
  const [b] = await db.insert(users).values({ telegramId: `${tag}_b`, username: "lib_b" }).returning();
  userA = a.id;
  userB = b.id;
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

describe("Library listing", () => {
  it("never exposes the Telegram post link, Telegram file id or the password hash — only hasPassword", async () => {
    const hashed = await makeFile(userA, "Locked", { password: "scrypt$salt$hash" });
    const res = await libraryGet(req("/api/files", { token: tokenA }));
    const list = (await res.json()).files as Record<string, unknown>[];
    const row = list.find((f) => f.id === hashed.id)!;
    expect(row.hasPassword).toBe(true);
    for (const k of ["telegramMessageLink", "telegramFileId", "password"]) expect(row).not.toHaveProperty(k);
    expect(JSON.stringify(list)).not.toMatch(/t\.me|tgfile-|scrypt\$/);
  });
});

describe("Edit Details (PATCH /api/files/:id)", () => {
  it("saves title + description, trims, and leaves published state, link, password and the Telegram post untouched", async () => {
    const f = await makeFile(userA, "Old title", { description: "old", password: "pw-hash", starsPrice: 5 });
    const res = await patch(tokenA, f.id, { title: "  New title  ", description: "  New description \n" });
    expect(res.status).toBe(200);
    const [row] = await db.select().from(files).where(eq(files.id, f.id));
    expect(row).toMatchObject({
      title: "New title", description: "New description", isPublished: true, smartLinkSlug: f.smartLinkSlug, password: "pw-hash",
      starsPrice: 5, telegramMessageLink: f.telegramMessageLink, telegramFileId: f.telegramFileId, userId: userA, id: f.id,
    });
  });

  it("an empty description clears it; a published file stays published", async () => {
    const f = await makeFile(userA, "T", { description: "something" });
    expect((await patch(tokenA, f.id, { description: "   " })).status).toBe(200);
    const [row] = await db.select().from(files).where(eq(files.id, f.id));
    expect(row.description).toBeNull();
    expect(row.isPublished).toBe(true);
  });

  it("validates: empty / over-long title, over-long or non-text description, bad id, bad body — and changes nothing", async () => {
    const f = await makeFile(userA, "Stable", { description: "keep" });
    for (const body of [{ title: "   " }, { title: "x".repeat(257) }, { description: "d".repeat(1001) }, { description: 42 }]) {
      const res = await patch(tokenA, f.id, body);
      expect(res.status, JSON.stringify(body).slice(0, 40)).toBe(400);
    }
    expect((await filePatch(req("/api/files/abc", { method: "PATCH", token: tokenA, json: { title: "x" } }), ctx("abc"))).status).toBe(400);
    expect((await filePatch(req(`/api/files/${f.id}`, { method: "PATCH", token: tokenA, raw: "{not json" }), ctx(f.id))).status).toBe(400);
    const [row] = await db.select().from(files).where(eq(files.id, f.id));
    expect(row).toMatchObject({ title: "Stable", description: "keep" });
  });

  it("requires a session and ownership (another creator's file is a 404 and unchanged)", async () => {
    const f = await makeFile(userA, "Mine");
    expect((await patch(undefined, f.id, { title: "x" })).status).toBe(401);
    expect((await patch(tokenB, f.id, { title: "hacked" })).status).toBe(404);
    expect((await db.select().from(files).where(eq(files.id, f.id)))[0].title).toBe("Mine");
  });
});

describe("Manage Playlists", () => {
  it("lists only the caller's playlists, flags membership, and reflects add / remove through the existing endpoints without duplicates", async () => {
    const f = await makeFile(userA, "Member");
    const other = await makeFile(userA, "Neighbour");
    const p1 = await makePlaylist(userA, "Public list");
    const p2 = await makePlaylist(userA, "Private list", false);
    const foreign = await makePlaylist(userB, "Not yours");
    await membersAdd(req(`/api/playlists/${p1.id}/files`, { method: "POST", token: tokenA, json: { fileIds: [other.id] } }), ctx(p1.id));

    let m = await memberships(tokenA, f.id);
    expect(m.status).toBe(200);
    const mine = m.body.playlists!.filter((p) => [p1.id, p2.id, foreign.id].includes(p.id));
    expect(mine.map((p) => p.id).sort()).toEqual([p1.id, p2.id].sort()); // B's playlist never listed
    expect(mine.every((p) => !p.isMember)).toBe(true);
    expect(mine.find((p) => p.id === p2.id)!.isPublished).toBe(false);
    expect(mine.find((p) => p.id === p1.id)!.fileCount).toBe(1);

    const add1 = await membersAdd(req(`/api/playlists/${p1.id}/files`, { method: "POST", token: tokenA, json: { fileIds: [f.id] } }), ctx(p1.id));
    expect(add1.status).toBe(200);
    const add2 = await membersAdd(req(`/api/playlists/${p2.id}/files`, { method: "POST", token: tokenA, json: { fileIds: [f.id] } }), ctx(p2.id));
    expect(add2.status).toBe(200);
    const dup = await membersAdd(req(`/api/playlists/${p1.id}/files`, { method: "POST", token: tokenA, json: { fileIds: [f.id] } }), ctx(p1.id));
    expect((await dup.json()).alreadyMembers).toEqual([f.id]);
    expect(await db.select().from(playlistFiles).where(and(eq(playlistFiles.playlistId, p1.id), eq(playlistFiles.fileId, f.id)))).toHaveLength(1);

    m = await memberships(tokenA, f.id);
    expect(m.body.playlists!.filter((p) => p.isMember).map((p) => p.id).sort()).toEqual([p1.id, p2.id].sort());

    // existing order of the neighbour is not disturbed: it stays first, the new file is appended
    const order = await db.select().from(playlistFiles).where(eq(playlistFiles.playlistId, p1.id));
    expect(order.sort((a, b) => a.position - b.position).map((r) => r.fileId)).toEqual([other.id, f.id]);

    const rem = await memberRemove(req(`/api/playlists/${p1.id}/files/${f.id}`, { method: "DELETE", token: tokenA }), ctx(p1.id, f.id));
    expect(rem.status).toBe(200);
    m = await memberships(tokenA, f.id);
    expect(m.body.playlists!.filter((p) => p.isMember).map((p) => p.id)).toEqual([p2.id]);
    expect(await db.select().from(files).where(eq(files.id, f.id))).toHaveLength(1); // the file itself stays
  });

  it("requires a session; someone else's file (or a missing one) is a 404; a bad id is a 400", async () => {
    const f = await makeFile(userA, "Private to A");
    expect((await memberships(undefined, f.id)).status).toBe(401);
    expect((await memberships(tokenB, f.id)).status).toBe(404);
    expect((await memberships(tokenA, 2147483000)).status).toBe(404);
    const bad = await filePlaylists(req("/api/files/abc/playlists", { token: tokenA }), ctx("abc"));
    expect(bad.status).toBe(400);
  });

  it("another creator cannot add MY file to THEIR playlist through the existing endpoint", async () => {
    const f = await makeFile(userA, "A's file");
    const theirs = await makePlaylist(userB, "B list");
    const res = await membersAdd(req(`/api/playlists/${theirs.id}/files`, { method: "POST", token: tokenB, json: { fileIds: [f.id] } }), ctx(theirs.id));
    expect(res.status).toBe(404);
    expect(await db.select().from(playlistFiles).where(eq(playlistFiles.fileId, f.id))).toHaveLength(0);
  });
});

describe("Delete File (DELETE /api/files/:id)", () => {
  it("removes only that file from the Library and from its playlists; other files, the playlists and other users' data stay; no Telegram call is made", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const victim = await makeFile(userA, "Victim");
    const keeper = await makeFile(userA, "Keeper");
    const pl = await makePlaylist(userA, "Shared list");
    await membersAdd(req(`/api/playlists/${pl.id}/files`, { method: "POST", token: tokenA, json: { fileIds: [victim.id, keeper.id] } }), ctx(pl.id));

    const res = await fileDelete(req(`/api/files/${victim.id}`, { method: "DELETE", token: tokenA }), ctx(victim.id));
    expect(res.status).toBe(200);
    expect(await db.select().from(files).where(eq(files.id, victim.id))).toHaveLength(0);
    expect(await db.select().from(files).where(eq(files.id, keeper.id))).toHaveLength(1);
    expect(await db.select().from(playlists).where(eq(playlists.id, pl.id))).toHaveLength(1);
    const left = await db.select().from(playlistFiles).where(eq(playlistFiles.playlistId, pl.id));
    expect(left.map((r) => r.fileId)).toEqual([keeper.id]); // no dangling reference
    const telegramCalls = fetchSpy.mock.calls.filter(([u]) => /telegram|t\.me/i.test(String(u instanceof Request ? u.url : u)));
    expect(telegramCalls).toHaveLength(0);
    fetchSpy.mockRestore();
  });

  it("requires a session and ownership: another creator's file survives, a missing id is a 404, a malformed id a 400", async () => {
    const f = await makeFile(userA, "Protected");
    expect((await fileDelete(req(`/api/files/${f.id}`, { method: "DELETE" }), ctx(f.id))).status).toBe(401);
    expect((await fileDelete(req(`/api/files/${f.id}`, { method: "DELETE", token: tokenB }), ctx(f.id))).status).toBe(404);
    expect(await db.select().from(files).where(eq(files.id, f.id))).toHaveLength(1);
    expect((await fileDelete(req("/api/files/2147483000", { method: "DELETE", token: tokenA }), ctx(2147483000))).status).toBe(404);
    expect((await fileDelete(req("/api/files/abc", { method: "DELETE", token: tokenA }), ctx("abc"))).status).toBe(400);
  });
});
