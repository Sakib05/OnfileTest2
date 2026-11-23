import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { channels, fileThumbnails, files, playlistFiles, playlists, sessions, users } from "@/db/schema";
import { createSession } from "@/lib/auth";
import { hashAccessPassword } from "@/lib/password";
import { POST as playlistsPost } from "../playlists/route";
import { PATCH as playlistPatch, DELETE as playlistDelete } from "../playlists/[id]/route";
import { POST as membersAdd, PUT as membersReorder } from "../playlists/[id]/files/route";
import { DELETE as memberRemove } from "../playlists/[id]/files/[fileId]/route";
import { POST as sharePost } from "../playlists/[id]/share/route";
import { GET as publicGet, POST as publicUnlock } from "./[slug]/route";
import { GET as linkGet, POST as linkUnlock } from "../link/[slug]/route";

/**
 * End-to-end: REAL route handlers + REAL Postgres. Public playlist sharing: stable unguessable link, privacy,
 * password + Stars rules, no data leaks, owner-only/CSRF protected share endpoint, and that individual files stay
 * protected by their own rules.
 */
const tag = `sh_${Date.now()}`;
const CDN = "https://cdn.example.test/tok";
let userA = 0;
let userB = 0;
let tokenA = "";
let tokenB = "";
let seq = 0;
let ipSeq = 0;
const savedEnv: Record<string, string | undefined> = {};

const ctx = <T extends Record<string, string>>(v: T) => ({ params: Promise.resolve(v) });

function req(p: string, init: { method?: string; token?: string; cookie?: string; json?: unknown; origin?: string } = {}) {
  const headers: Record<string, string> = { host: "localhost", "x-forwarded-for": `10.9.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}` };
  const cookies = [init.token ? `onfile_session=${init.token}` : "", init.cookie ?? ""].filter(Boolean).join("; ");
  if (cookies) headers.cookie = cookies;
  if (init.origin) headers.origin = init.origin;
  if (init.json !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(`http://localhost${p}`, { method: init.method ?? "GET", headers, body: init.json !== undefined ? JSON.stringify(init.json) : undefined });
}

async function makeFile(userId: number, title: string, extra: Partial<typeof files.$inferInsert> = {}, thumb = false) {
  const n = ++seq;
  const [f] = await db
    .insert(files)
    .values({ userId, title, fileType: "document", fileSize: 2048, telegramMessageLink: `https://t.me/c/99${userId}/${n}`, telegramFileId: `tgfile${n}`, smartLinkSlug: `${tag}-f${n}`, isPublished: true, ...extra })
    .returning();
  if (thumb) {
    await db.insert(fileThumbnails).values({ userId, fileId: f.id, objectKey: `thumb-${tag}-${f.id}.webp`, version: "v1", mimeType: "image/webp", format: "webp", sizeBytes: 1000, width: 640, height: 360 });
  }
  return f;
}

async function makePlaylist(token: string, title: string, json: Record<string, unknown> = {}) {
  const res = await playlistsPost(req("/api/playlists", { method: "POST", token, json: { title, ...json } }));
  expect(res.status).toBe(201);
  return (await res.json()).playlist as { id: number };
}
const addFiles = (token: string, pid: number, fileIds: number[]) =>
  membersAdd(req(`/api/playlists/${pid}/files`, { method: "POST", token, json: { fileIds } }), ctx({ id: String(pid) }));
const share = (token: string | undefined, pid: number | string, origin?: string) =>
  sharePost(req(`/api/playlists/${pid}/share`, { method: "POST", token, origin }), ctx({ id: String(pid) }));
const getPublic = (slug: string, o: { token?: string; cookie?: string } = {}) => publicGet(req(`/api/p/${slug}`, o), ctx({ slug }));
const unlock = (slug: string, password: unknown) => publicUnlock(req(`/api/p/${slug}`, { method: "POST", json: { password } }), ctx({ slug }));
const shareOf = async (token: string, pid: number) => {
  const res = await share(token, pid);
  expect(res.status).toBe(200);
  return (await res.json()).share as { slug: string; path: string; url: string; hasPassword: boolean };
};

beforeAll(async () => {
  for (const [k, v] of Object.entries({ DBBYTE_API_KEY: "k", DBBYTE_BUCKET: "test-bucket", DBBYTE_CDN_BASE_URL: CDN })) {
    savedEnv[k] = process.env[k];
    process.env[k] = v;
  }
  const [a] = await db.insert(users).values({ telegramId: `${tag}_a`, username: "share_a", firstName: "Alice" }).returning();
  const [b] = await db.insert(users).values({ telegramId: `${tag}_b`, username: "share_b" }).returning();
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
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("share link creation (owner only)", () => {
  it("creates an unguessable, stable link: same playlist → same link, never the numeric id", async () => {
    const pl = await makePlaylist(tokenA, "Stable");
    const s1 = await shareOf(tokenA, pl.id);
    const s2 = await shareOf(tokenA, pl.id);
    expect(s1.slug).toBe(s2.slug);
    expect(s1.slug).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(s1.slug).not.toContain(String(pl.id) + "-");
    expect(s1.path).toBe(`/p/${s1.slug}`);
    expect(s1.url).toBe(`http://localhost/p/${s1.slug}`);
    const [row] = await db.select().from(playlists).where(eq(playlists.id, pl.id));
    expect(row.shareSlug).toBe(s1.slug);
  });

  it("two playlists never share a token", async () => {
    const a = await makePlaylist(tokenA, "T1");
    const b = await makePlaylist(tokenA, "T2");
    expect((await shareOf(tokenA, a.id)).slug).not.toBe((await shareOf(tokenA, b.id)).slug);
  });

  it("requires a session, ownership and a same-origin request", async () => {
    const pl = await makePlaylist(tokenA, "Owner only");
    expect((await share(undefined, pl.id)).status).toBe(401);
    expect((await share(tokenB, pl.id)).status).toBe(404); // someone else's playlist == not found
    expect((await share(tokenA, pl.id, "https://evil.example")).status).toBe(403); // CSRF
    expect((await share(tokenA, "abc")).status).toBe(400);
    const [row] = await db.select().from(playlists).where(eq(playlists.id, pl.id));
    expect(row.shareSlug).toBeNull(); // none of the rejected calls created a token
  });

  it("refuses private (unpublished) playlists until the owner publishes them, then keeps the same link", async () => {
    const pl = await makePlaylist(tokenA, "Was private");
    await playlistPatch(req(`/api/playlists/${pl.id}`, { method: "PATCH", token: tokenA, json: { isPublished: false } }), ctx({ id: String(pl.id) }));
    const blocked = await share(tokenA, pl.id);
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).reason).toBe("private");
    await playlistPatch(req(`/api/playlists/${pl.id}`, { method: "PATCH", token: tokenA, json: { isPublished: true } }), ctx({ id: String(pl.id) }));
    expect((await share(tokenA, pl.id)).status).toBe(200);
  });

  it("refuses Stars-priced playlists (no payment backend → no bypass)", async () => {
    const pl = await makePlaylist(tokenA, "Paid", { starsPrice: 50 });
    const res = await share(tokenA, pl.id);
    expect(res.status).toBe(409);
    expect((await res.json()).reason).toBe("paid_unavailable");
  });
});

describe("public viewing", () => {
  it("shows the ordered published items + cover, and nothing private", async () => {
    const pl = await makePlaylist(tokenA, "Course", { description: "Intro" });
    const f1 = await makeFile(userA, "Lesson 1.pdf", {}, true);
    const f2 = await makeFile(userA, "Lesson 2.pdf");
    const f3 = await makeFile(userA, "Lesson 3.pdf", { password: hashAccessPassword("filepw"), starsPrice: 5 });
    await addFiles(tokenA, pl.id, [f1.id, f2.id, f3.id]);
    await membersReorder(req(`/api/playlists/${pl.id}/files`, { method: "PUT", token: tokenA, json: { fileIds: [f2.id, f1.id, f3.id] } }), ctx({ id: String(pl.id) }));
    const { slug } = await shareOf(tokenA, pl.id);

    const res = await getPublic(slug); // anonymous visitor, no cookies at all
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.playlist).toMatchObject({ title: "Course", description: "Intro", itemCount: 3, locked: null, hasPassword: false });
    expect(body.items.map((i: { title: string }) => i.title)).toEqual(["Lesson 2.pdf", "Lesson 1.pdf", "Lesson 3.pdf"]); // saved order kept
    expect(body.items.map((i: { position: number }) => i.position)).toEqual([1, 2, 3]);
    expect(body.items[0].slug).toBe(f2.smartLinkSlug);
    expect(body.items[2]).toMatchObject({ hasPassword: true, starsPrice: 5 });
    expect(body.playlist.thumbnailUrl).toBeNull(); // first item has no thumbnail → default art (same rule as the owner's cover)
    expect(body.creator).toEqual({ firstName: "Alice", username: "share_a", avatarUrl: null, customAvatarUrl: null });

    // privacy: serialised response contains no internal ids, hashes or Telegram data
    const raw = JSON.stringify(body);
    for (const secret of ["telegramMessageLink", "t.me/c/", "telegramFileId", "tgfile", "scrypt:", "userId", "user_id", String(userA), "channel", "password\":\""]) {
      expect(raw).not.toContain(secret);
    }
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("the cover is the first item's thumbnail", async () => {
    const pl = await makePlaylist(tokenA, "Cover");
    const f = await makeFile(userA, "Cover file.pdf", {}, true);
    await addFiles(tokenA, pl.id, [f.id]);
    const { slug } = await shareOf(tokenA, pl.id);
    const body = await (await getPublic(slug)).json();
    expect(body.playlist.thumbnailUrl).toBe(`${CDN}/test-bucket/thumb-${tag}-${f.id}.webp`);
  });

  it("unpublished files are never listed, counted or used as the cover", async () => {
    const pl = await makePlaylist(tokenA, "Mixed");
    const secret = await makeFile(userA, "SECRET draft.pdf", { isPublished: false }, true);
    const pub = await makeFile(userA, "Public.pdf");
    const noLink = await makeFile(userA, "No link.pdf", { smartLinkSlug: null });
    await addFiles(tokenA, pl.id, [secret.id, pub.id, noLink.id]);
    const { slug } = await shareOf(tokenA, pl.id);
    const body = await (await getPublic(slug)).json();
    expect(body.items.map((i: { title: string }) => i.title)).toEqual(["Public.pdf"]);
    expect(body.playlist.itemCount).toBe(1);
    expect(body.playlist.thumbnailUrl).toBeNull();
    expect(JSON.stringify(body)).not.toContain("SECRET");
    expect(JSON.stringify(body)).not.toContain(`thumb-${tag}-${secret.id}`);
  });

  it("an unknown token, a numeric id and malformed values all answer the same 404", async () => {
    const pl = await makePlaylist(tokenA, "Probe");
    await shareOf(tokenA, pl.id);
    for (const s of ["AAAAAAAAAAAAAAAA", String(pl.id), "short", "../etc/passwd", "x".repeat(64)]) {
      const r = await getPublic(s);
      expect(r.status).toBe(404);
      expect(await r.json()).toEqual({ error: "Playlist not found" });
    }
  });

  it("a playlist that was never shared has no public page; a private one stops working immediately and resumes when re-published", async () => {
    const pl = await makePlaylist(tokenA, "Toggle");
    const { slug } = await shareOf(tokenA, pl.id);
    expect((await getPublic(slug)).status).toBe(200);
    await playlistPatch(req(`/api/playlists/${pl.id}`, { method: "PATCH", token: tokenA, json: { isPublished: false } }), ctx({ id: String(pl.id) }));
    expect((await getPublic(slug)).status).toBe(404);
    expect((await publicUnlock(req(`/api/p/${slug}`, { method: "POST", json: { password: "x" } }), ctx({ slug }))).status).toBe(404);
    await playlistPatch(req(`/api/playlists/${pl.id}`, { method: "PATCH", token: tokenA, json: { isPublished: true } }), ctx({ id: String(pl.id) }));
    expect((await getPublic(slug)).status).toBe(200); // stable link
  });

  it("a deleted playlist's link is gone", async () => {
    const pl = await makePlaylist(tokenA, "Doomed");
    const { slug } = await shareOf(tokenA, pl.id);
    await playlistDelete(req(`/api/playlists/${pl.id}`, { method: "DELETE", token: tokenA }), ctx({ id: String(pl.id) }));
    expect((await getPublic(slug)).status).toBe(404);
  });

  it("removing a file from the playlist removes it from the public view but never deletes the Library file; deleting the playlist keeps files", async () => {
    const pl = await makePlaylist(tokenA, "Membership");
    const f1 = await makeFile(userA, "Keep me 1.pdf");
    const f2 = await makeFile(userA, "Keep me 2.pdf");
    await addFiles(tokenA, pl.id, [f1.id, f2.id]);
    const { slug } = await shareOf(tokenA, pl.id);
    await memberRemove(req(`/api/playlists/${pl.id}/files/${f1.id}`, { method: "DELETE", token: tokenA }), ctx({ id: String(pl.id), fileId: String(f1.id) }));
    const body = await (await getPublic(slug)).json();
    expect(body.items.map((i: { title: string }) => i.title)).toEqual(["Keep me 2.pdf"]);
    expect((await db.select().from(files).where(eq(files.id, f1.id))).length).toBe(1);
    await playlistDelete(req(`/api/playlists/${pl.id}`, { method: "DELETE", token: tokenA }), ctx({ id: String(pl.id) }));
    expect((await db.select().from(files).where(inArray(files.id, [f1.id, f2.id]))).length).toBe(2);
    expect((await db.select().from(playlistFiles).where(eq(playlistFiles.playlistId, pl.id))).length).toBe(0);
  });
});

describe("password-protected playlists", () => {
  let slug = "";
  let pid = 0;
  beforeAll(async () => {
    const pl = await makePlaylist(tokenA, "Locked", { password: "open sesame" });
    pid = pl.id;
    const f = await makeFile(userA, "Behind the password.pdf", {}, true);
    await addFiles(tokenA, pl.id, [f.id]);
    slug = (await shareOf(tokenA, pl.id)).slug;
  });

  it("anonymous visitors see only title/description — no items, no cover, no count", async () => {
    const body = await (await getPublic(slug)).json();
    expect(body.playlist).toMatchObject({ title: "Locked", locked: "password", hasPassword: true, itemCount: 0, thumbnailUrl: null });
    expect(body.items).toEqual([]);
    expect(JSON.stringify(body)).not.toContain("Behind the password");
  });

  it("a wrong or missing password is rejected and sets no cookie", async () => {
    for (const p of ["nope", "", 123, null]) {
      const r = await unlock(slug, p);
      expect(r.status).toBe(403);
      expect(r.headers.get("set-cookie")).toBeNull();
    }
  });

  it("the right password sets an HttpOnly cookie that unlocks the items for that browser only", async () => {
    const r = await unlock(slug, "open sesame");
    expect(r.status).toBe(200);
    const setCookie = r.headers.get("set-cookie")!;
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=lax/i);
    const cookie = setCookie.split(";")[0];
    const open = await (await getPublic(slug, { cookie })).json();
    expect(open.playlist.locked).toBeNull();
    expect(open.items).toHaveLength(1);
    // a forged / foreign cookie value doesn't work
    const name = cookie.split("=")[0];
    for (const bad of [`${name}=${"0".repeat(64)}`, `${name}=zzz`, `${name}=`]) {
      expect((await (await getPublic(slug, { cookie: bad })).json()).playlist.locked).toBe("password");
    }
  });

  it("changing the password revokes cookies issued under the old one", async () => {
    const cookie = (await unlock(slug, "open sesame")).headers.get("set-cookie")!.split(";")[0];
    await playlistPatch(req(`/api/playlists/${pid}`, { method: "PATCH", token: tokenA, json: { password: "new secret" } }), ctx({ id: String(pid) }));
    expect((await (await getPublic(slug, { cookie })).json()).playlist.locked).toBe("password");
    expect((await unlock(slug, "open sesame")).status).toBe(403);
    expect((await unlock(slug, "new secret")).status).toBe(200);
  });

  it("the owner can preview without typing the password; another logged-in user cannot", async () => {
    expect((await (await getPublic(slug, { token: tokenA })).json()).playlist.locked).toBeNull();
    expect((await (await getPublic(slug, { token: tokenB })).json()).playlist.locked).toBe("password");
  });

  it("unlock attempts are rate limited and require a same-origin request", async () => {
    const csrf = await publicUnlock(new NextRequest(`http://localhost/api/p/${slug}`, { method: "POST", headers: { host: "localhost", origin: "https://evil.example", "content-type": "application/json" }, body: JSON.stringify({ password: "new secret" }) }), ctx({ slug }));
    expect(csrf.status).toBe(403);
    const same = { host: "localhost", "x-forwarded-for": "203.0.113.77", "content-type": "application/json" };
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      statuses.push((await publicUnlock(new NextRequest(`http://localhost/api/p/${slug}`, { method: "POST", headers: same, body: JSON.stringify({ password: "bad" + i }) }), ctx({ slug }))).status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 403)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
  });
});

describe("Stars-priced playlists stay locked", () => {
  it("a playlist priced AFTER it was shared locks its items and rejects unlock, even for the owner's password holders", async () => {
    const pl = await makePlaylist(tokenA, "Gets a price");
    const f = await makeFile(userA, "Paid content.pdf");
    await addFiles(tokenA, pl.id, [f.id]);
    const { slug } = await shareOf(tokenA, pl.id);
    expect((await (await getPublic(slug)).json()).items).toHaveLength(1);
    await playlistPatch(req(`/api/playlists/${pl.id}`, { method: "PATCH", token: tokenA, json: { starsPrice: 25 } }), ctx({ id: String(pl.id) }));
    const body = await (await getPublic(slug)).json();
    expect(body.playlist.locked).toBe("stars");
    expect(body.items).toEqual([]);
    expect((await unlock(slug, "anything")).status).toBe(403);
  });
});

describe("individual files stay protected", () => {
  it("the playlist API never returns a Telegram link; the file endpoint still demands the file's own password", async () => {
    const pl = await makePlaylist(tokenA, "File rules");
    const f = await makeFile(userA, "Protected.pdf", { password: hashAccessPassword("filepw") });
    await addFiles(tokenA, pl.id, [f.id]);
    const { slug } = await shareOf(tokenA, pl.id);
    const body = await (await getPublic(slug)).json();
    expect(JSON.stringify(body)).not.toContain("t.me");
    const itemSlug = body.items[0].slug as string;

    const info = await linkGet(req(`/api/link/${itemSlug}`), ctx({ slug: itemSlug }));
    expect(info.status).toBe(200);
    expect((await info.json()).file.hasPassword).toBe(true);
    const denied = await linkUnlock(req(`/api/link/${itemSlug}`, { method: "POST", json: { password: "wrong" } }), ctx({ slug: itemSlug }));
    expect(denied.status).toBe(403);
    expect(JSON.stringify(await denied.json())).not.toContain("t.me");
    const granted = await linkUnlock(req(`/api/link/${itemSlug}`, { method: "POST", json: { password: "filepw" } }), ctx({ slug: itemSlug }));
    expect((await granted.json()).telegramMessageLink).toContain("t.me");
  });

  it("an unpublished file has no public link at all, so listing it in a playlist can't expose it", async () => {
    const f = await makeFile(userA, "Hidden.pdf", { isPublished: false });
    const r = await linkGet(req(`/api/link/${f.smartLinkSlug}`), ctx({ slug: f.smartLinkSlug! }));
    expect(r.status).toBe(404);
  });
});
