import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { analytics, channels, files, playlistFiles, playlists, sessions, users } from "@/db/schema";
import { createSession } from "@/lib/auth";
import { hashAccessPassword } from "@/lib/password";
import { generateShareSlug, makeUnlockToken, unlockCookieName } from "@/lib/publicPlaylist";
import { GET as analyticsGet } from "./[id]/analytics/route";
import { GET as publicGet } from "../p/[slug]/route";
import { POST as unlockPost } from "../link/[slug]/route";
import { POST as deliveredPost } from "../link/[slug]/delivered/route";
import { POST as legacyEventPost } from "../analytics/route";

/**
 * REAL handlers + sessions + Postgres: view counting, delivery confirmation (idempotent, attributed), owner-only
 * aggregation, date ranges / timezones, privacy of the response.
 */
const tag = `pa_${Date.now()}`;
const BROWSER = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36";
const ids = { a: 0, b: 0 };
let tokenA = "";
let tokenB = "";
let seq = 0;
let ipSeq = 0;

type P = { id: number; slug: string };
let p1: P; // public, contains F and G
let p2: P; // public, contains F only
let pPriv: P; // unpublished
let pPw: P; // password protected, contains F
let fileF = { id: 0, slug: "" };
let fileG = { id: 0, slug: "" };
let fileH = { id: 0, slug: "" }; // owned by A but in no playlist
let filePw = { id: 0, slug: "" }; // password-protected FILE in p1

const ctxSlug = (slug: string) => ({ params: Promise.resolve({ slug }) });
const ctxId = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });

function req(path: string, init: { method?: string; token?: string; json?: unknown; ua?: string | null; cookies?: string[]; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { host: "localhost", "x-forwarded-for": `10.9.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`, ...(init.headers ?? {}) };
  if (init.ua !== null) headers["user-agent"] = init.ua ?? BROWSER;
  const cookies = [...(init.cookies ?? [])];
  if (init.token) cookies.push(`onfile_session=${init.token}`);
  if (cookies.length) headers.cookie = cookies.join("; ");
  if (init.json !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(`http://localhost${path}`, { method: init.method ?? "GET", headers, body: init.json !== undefined ? JSON.stringify(init.json) : undefined });
}

const cookieFrom = (res: Response, name: string) => res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`))?.split(";")[0]?.split("=")[1];

async function mkFile(userId: number, title: string, extra: Partial<typeof files.$inferInsert> = {}) {
  const [f] = await db
    .insert(files)
    .values({ userId, title, fileType: "document", telegramMessageLink: `https://t.me/c/77${userId}/${++seq}`, smartLinkSlug: `${tag}-f${seq}`, isPublished: true, ...extra })
    .returning();
  return { id: f.id, slug: f.smartLinkSlug! };
}
async function mkPlaylist(userId: number, title: string, extra: Partial<typeof playlists.$inferInsert> = {}): Promise<P> {
  const slug = generateShareSlug();
  const [p] = await db.insert(playlists).values({ userId, title, shareSlug: slug, isPublished: true, ...extra }).returning();
  return { id: p.id, slug };
}
const addMember = (pl: P, f: { id: number }, userId: number, position = 0) => db.insert(playlistFiles).values({ playlistId: pl.id, fileId: f.id, userId, position });

const count = async (playlistId: number, type: string) =>
  Number((await db.select({ n: sql<number>`count(*)::int` }).from(analytics).where(and(eq(analytics.playlistId, playlistId), eq(analytics.eventType, type))))[0].n);

async function viewAs(slug: string, opts: Parameters<typeof req>[1] = {}) {
  return publicGet(req(`/api/p/${slug}`, opts), ctxSlug(slug));
}
async function unlock(fileSlug: string, json: Record<string, unknown>, opts: Parameters<typeof req>[1] = {}) {
  const res = await unlockPost(req(`/api/link/${fileSlug}`, { method: "POST", json, ...opts }), ctxSlug(fileSlug));
  return { res, body: (await res.json()) as { success?: boolean; receipt?: string; telegramMessageLink?: string; error?: string } };
}
async function delivered(fileSlug: string, receipt: unknown) {
  const res = await deliveredPost(req(`/api/link/${fileSlug}/delivered`, { method: "POST", json: { receipt } }), ctxSlug(fileSlug));
  return (await res.json()) as { counted: boolean };
}
async function getAnalytics(id: number | string, qs: string, token: string | null = tokenA) {
  const res = await analyticsGet(req(`/api/playlists/${id}/analytics?${qs}`, { token: token ?? undefined }), ctxId(id));
  return { res, body: (await res.json()) as Record<string, any> };
}

beforeAll(async () => {
  const [a] = await db.insert(users).values({ telegramId: `${tag}_a`, username: "pa_a" }).returning();
  const [b] = await db.insert(users).values({ telegramId: `${tag}_b`, username: "pa_b" }).returning();
  ids.a = a.id;
  ids.b = b.id;
  await db.insert(channels).values([
    { userId: a.id, telegramChannelId: "-1007700000001", channelName: "A", status: "verified", isVerified: true },
    { userId: b.id, telegramChannelId: "-1007700000002", channelName: "B", status: "verified", isVerified: true },
  ]);
  tokenA = (await createSession(a.id)).token;
  tokenB = (await createSession(b.id)).token;

  p1 = await mkPlaylist(a.id, "Business Studies");
  p2 = await mkPlaylist(a.id, "Second");
  pPriv = await mkPlaylist(a.id, "Private one", { isPublished: false });
  pPw = await mkPlaylist(a.id, "Locked", { password: hashAccessPassword("pw") });
  fileF = await mkFile(a.id, "File F");
  fileG = await mkFile(a.id, "File G");
  fileH = await mkFile(a.id, "File H (not in any playlist)");
  filePw = await mkFile(a.id, "File PW", { password: hashAccessPassword("secret") });
  await addMember(p1, fileF, a.id, 0);
  await addMember(p1, fileG, a.id, 1);
  await addMember(p1, filePw, a.id, 2);
  await addMember(p2, fileF, a.id, 0);
  await addMember(pPw, fileF, a.id, 0);
  await addMember(pPriv, fileF, a.id, 0);
});

afterAll(async () => {
  const uids = [ids.a, ids.b].filter(Boolean);
  if (!uids.length) return;
  const pls = await db.select({ id: playlists.id }).from(playlists).where(inArray(playlists.userId, uids));
  if (pls.length) await db.delete(analytics).where(inArray(analytics.playlistId, pls.map((p) => p.id)));
  await db.delete(files).where(inArray(files.userId, uids));
  await db.delete(playlists).where(inArray(playlists.userId, uids));
  await db.delete(sessions).where(inArray(sessions.userId, uids));
  await db.delete(users).where(inArray(users.id, uids));
});

describe("views", () => {
  it("counts one view per anonymous visitor within the dedupe window; refreshes don't inflate", async () => {
    const first = await viewAs(p1.slug);
    expect(first.status).toBe(200);
    const vid = cookieFrom(first, "onfile_vid");
    expect(vid).toBeTruthy();
    expect(await count(p1.id, "playlist_view")).toBe(1);

    for (let i = 0; i < 3; i++) await viewAs(p1.slug, { cookies: [`onfile_vid=${vid}`] }); // refreshes
    expect(await count(p1.id, "playlist_view")).toBe(1);

    await viewAs(p1.slug); // a different visitor
    expect(await count(p1.id, "playlist_view")).toBe(2);
    const { body } = await getAnalytics(p1.id, "range=7d&tz=UTC");
    expect(body.views).toEqual({ total: 2, unique: 2 });
  });

  it("does not count the owner's preview, bots, link-preview fetchers, prefetches, or missing user agents", async () => {
    const before = await count(p2.id, "playlist_view");
    await viewAs(p2.slug, { token: tokenA }); // owner preview
    await viewAs(p2.slug, { ua: "Googlebot/2.1 (+http://www.google.com/bot.html)" });
    await viewAs(p2.slug, { ua: "TelegramBot (like TwitterBot)" });
    await viewAs(p2.slug, { ua: "curl/8.4.0" });
    await viewAs(p2.slug, { ua: null });
    await viewAs(p2.slug, { headers: { "sec-purpose": "prefetch" } });
    expect(await count(p2.id, "playlist_view")).toBe(before);
    await viewAs(p2.slug);
    expect(await count(p2.id, "playlist_view")).toBe(before + 1);
  });

  it("never counts private/unknown playlists (they 404) and a password-locked page still counts as a page view", async () => {
    expect((await viewAs(pPriv.slug)).status).toBe(404);
    expect(await count(pPriv.id, "playlist_view")).toBe(0);
    expect((await viewAs(pPw.slug)).status).toBe(200);
    expect(await count(pPw.id, "playlist_view")).toBe(1);
  });

  it("a page view is never a download", async () => {
    expect(await count(p1.id, "playlist_download")).toBe(0);
  });
});

describe("downloads: confirmed hand-off only, idempotent, attributed to the playlist used", () => {
  it("an unlock alone is NOT a download; confirming the receipt counts exactly once", async () => {
    const { res, body } = await unlock(fileF.slug, { playlist: p1.slug });
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.telegramMessageLink).toContain("t.me");
    expect(body.receipt).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(await count(p1.id, "playlist_download")).toBe(0); // request only

    expect((await delivered(fileF.slug, body.receipt)).counted).toBe(true);
    expect(await count(p1.id, "playlist_download")).toBe(1);

    // retries / double taps / replays never add more
    expect((await delivered(fileF.slug, body.receipt)).counted).toBe(false);
    expect((await delivered(fileF.slug, body.receipt)).counted).toBe(false);
    expect(await count(p1.id, "playlist_download")).toBe(1);
  });

  it("a second genuine delivery of the same file (new unlock, opened again) is a second download", async () => {
    const { body } = await unlock(fileF.slug, { playlist: p1.slug });
    await delivered(fileF.slug, body.receipt);
    expect(await count(p1.id, "playlist_download")).toBe(2);
  });

  it("attribution: a file in several playlists is counted only for the playlist it was requested through", async () => {
    expect(await count(p2.id, "playlist_download")).toBe(0);
    const { body } = await unlock(fileF.slug, { playlist: p2.slug });
    await delivered(fileF.slug, body.receipt);
    expect(await count(p2.id, "playlist_download")).toBe(1);
    expect(await count(p1.id, "playlist_download")).toBe(2); // unchanged
  });

  it("standalone unlocks, files outside the playlist, bad/private/locked playlist context are not attributed (but still unlock)", async () => {
    const standalone = await unlock(fileF.slug, {});
    expect(standalone.body.success).toBe(true);
    expect(standalone.body.receipt).toBeUndefined();

    const notMember = await unlock(fileH.slug, { playlist: p1.slug });
    expect(notMember.body.success).toBe(true);
    expect(notMember.body.receipt).toBeUndefined();

    const privateCtx = await unlock(fileF.slug, { playlist: pPriv.slug });
    expect(privateCtx.body.success).toBe(true);
    expect(privateCtx.body.receipt).toBeUndefined();

    const locked = await unlock(fileF.slug, { playlist: pPw.slug }); // password playlist, cookie not presented
    expect(locked.body.success).toBe(true);
    expect(locked.body.receipt).toBeUndefined();

    const junk = await unlock(fileF.slug, { playlist: "not-a-token" });
    expect(junk.body.receipt).toBeUndefined();

    const bot = await unlock(fileF.slug, { playlist: p1.slug }, { ua: "curl/8.0.0" });
    expect(bot.body.receipt).toBeUndefined();

    const owner = await unlock(fileF.slug, { playlist: p1.slug }, { token: tokenA });
    expect(owner.body.receipt).toBeUndefined(); // creator testing their own delivery
  });

  it("a password-protected playlist attributes once the visitor holds its unlock cookie", async () => {
    const [row] = await db.select().from(playlists).where(eq(playlists.id, pPw.id));
    const cookie = `${unlockCookieName(pPw.slug)}=${makeUnlockToken(row)}`;
    const { body } = await unlock(fileF.slug, { playlist: pPw.slug }, { cookies: [cookie] });
    expect(body.receipt).toBeTruthy();
    await delivered(fileF.slug, body.receipt);
    expect(await count(pPw.id, "playlist_download")).toBe(1);
  });

  it("failed unlocks (wrong password) create nothing; the file's own password rule is unchanged", async () => {
    const before = await db.select({ n: sql<number>`count(*)::int` }).from(analytics).where(eq(analytics.playlistId, p1.id));
    const bad = await unlock(filePw.slug, { playlist: p1.slug, password: "wrong" });
    expect(bad.res.status).toBe(403);
    expect(bad.body.receipt).toBeUndefined();
    const after = await db.select({ n: sql<number>`count(*)::int` }).from(analytics).where(eq(analytics.playlistId, p1.id));
    expect(after[0].n).toBe(before[0].n);
    const good = await unlock(filePw.slug, { playlist: p1.slug, password: "secret" });
    expect(good.res.status).toBe(200);
    expect(good.body.receipt).toBeTruthy();
  });

  it("a receipt cannot be used for another file, cannot be invented, and expires", async () => {
    const { body } = await unlock(fileG.slug, { playlist: p1.slug });
    expect((await delivered(fileF.slug, body.receipt)).counted).toBe(false); // wrong file
    expect((await delivered(fileG.slug, "A".repeat(22))).counted).toBe(false); // invented
    expect((await delivered(fileG.slug, "short")).counted).toBe(false);
    expect((await delivered(fileG.slug, undefined)).counted).toBe(false);

    await db.execute(sql`UPDATE analytics SET created_at = (now() AT TIME ZONE 'UTC') - interval '2 hours' WHERE event_key = ${`u:${body.receipt}`}`);
    expect((await delivered(fileG.slug, body.receipt)).counted).toBe(false); // expired
    const g = await db.select({ n: sql<number>`count(*)::int` }).from(analytics).where(and(eq(analytics.fileId, fileG.id), eq(analytics.eventType, "playlist_download")));
    expect(g[0].n).toBe(0);
  });

  it("the legacy open analytics endpoint cannot be used to inject playlist events", async () => {
    for (const eventType of ["playlist_view", "playlist_download", "playlist_unlock"]) {
      const res = await legacyEventPost(req("/api/analytics", { method: "POST", json: { playlistId: p1.id, eventType } }));
      expect(res.status).toBe(400);
    }
  });
});

describe("GET /api/playlists/:id/analytics", () => {
  it("returns aggregated Views, Downloads and an honest 'not available' for Earnings", async () => {
    const { res, body } = await getAnalytics(p1.id, "range=30d&tz=UTC");
    expect(res.status).toBe(200);
    expect(body.playlist).toEqual({ id: p1.id, title: "Business Studies" });
    expect(body.views.total).toBe(2);
    expect(body.downloads.total).toBe(2); // F twice. Unconfirmed unlocks (G, the password file), expired / wrong-file receipts and the other playlists are excluded
    expect(body.earnings.available).toBe(false);
    expect(body.series).toHaveLength(30);
    const sumViews = body.series.reduce((a: number, p: { views: number }) => a + p.views, 0);
    const sumDl = body.series.reduce((a: number, p: { downloads: number }) => a + p.downloads, 0);
    expect(sumViews).toBe(body.views.total);
    expect(sumDl).toBe(body.downloads.total);
    expect(body.insights.topFiles[0]).toMatchObject({ title: "File F", downloads: 2 });
  });

  it("is owner-only: 401 without a session, 404 for another creator or a missing playlist, 400 for a bad id", async () => {
    expect((await getAnalytics(p1.id, "range=7d", null)).res.status).toBe(401);
    const other = await getAnalytics(p1.id, "range=7d", tokenB);
    expect(other.res.status).toBe(404);
    expect(JSON.stringify(other.body)).not.toContain("Business Studies");
    expect((await getAnalytics(2147483000, "range=7d")).res.status).toBe(404);
    expect((await getAnalytics("abc", "range=7d")).res.status).toBe(400);
  });

  it("only exposes aggregates: no raw events, visitor hashes, ids of files, tokens or Telegram data", async () => {
    const { body } = await getAnalytics(p1.id, "range=all&tz=UTC");
    const text = JSON.stringify(body);
    expect(text).not.toContain(p1.slug);
    expect(text).not.toMatch(/telegram|t\.me|visitor|ipHash|ip_hash|event_key|receipt|password|file_id|fileId|\"id\":\d+,\"title\":\"File/i);
    expect(Object.keys(body).sort()).toEqual(["downloads", "earnings", "insights", "playlist", "range", "series", "views"]);
  });

  it("date filters change every metric: today vs. an empty past window vs. all time", async () => {
    const all = await getAnalytics(p1.id, "range=all&tz=UTC");
    expect(all.body.views.total).toBe(2);
    expect(all.body.downloads.total).toBe(2);

    const past = await getAnalytics(p1.id, "range=custom&from=2024-01-01&to=2024-01-31&tz=UTC");
    expect(past.res.status).toBe(200);
    expect(past.body.views).toEqual({ total: 0, unique: 0 });
    expect(past.body.downloads.total).toBe(0);
    expect(past.body.series).toHaveLength(31);
    expect(past.body.insights.bestDay).toBeNull();

    const today = past.body.range.today as string;
    const todayOnly = await getAnalytics(p1.id, `range=custom&from=${today}&to=${today}&tz=UTC`);
    expect(todayOnly.body.views.total).toBe(2);
    expect(todayOnly.body.series).toHaveLength(1);
  });

  it("validates ranges, timezones and future dates", async () => {
    expect((await getAnalytics(p1.id, "range=nope")).res.status).toBe(400);
    expect((await getAnalytics(p1.id, "range=7d&tz=Mars/Base")).res.status).toBe(400);
    expect((await getAnalytics(p1.id, "range=custom&from=2024-02-01&to=2024-01-01")).res.status).toBe(400);
    expect((await getAnalytics(p1.id, "range=custom&from=2999-01-01&to=2999-02-01")).res.status).toBe(400);
    const clamped = await getAnalytics(p1.id, "range=custom&from=2024-01-01&to=2999-01-01&tz=UTC");
    expect(clamped.res.status).toBe(200);
    expect(clamped.body.range.to).toBe(clamped.body.range.today);
  });

  it("groups by the viewer's timezone (UTC 23:30 is already the next day in Dhaka) and aggregates long ranges weekly", async () => {
    const [pl] = await db.insert(playlists).values({ userId: ids.a, title: "TZ", shareSlug: generateShareSlug(), isPublished: true }).returning();
    await db.execute(sql`
      INSERT INTO analytics (playlist_id, event_type, event_key, visitor_hash, created_at) VALUES
        (${pl.id}, 'playlist_view', ${`${tag}:tz1`}, 'h1', '2024-03-10 23:30:00'),
        (${pl.id}, 'playlist_view', ${`${tag}:tz2`}, 'h2', '2024-03-10 10:00:00')`);
    const utc = await getAnalytics(pl.id, "range=custom&from=2024-03-10&to=2024-03-10&tz=UTC");
    expect(utc.body.views).toEqual({ total: 2, unique: 2 });
    const dhaka10 = await getAnalytics(pl.id, "range=custom&from=2024-03-10&to=2024-03-10&tz=Asia/Dhaka");
    const dhaka11 = await getAnalytics(pl.id, "range=custom&from=2024-03-11&to=2024-03-11&tz=Asia/Dhaka");
    expect(dhaka10.body.views.total).toBe(1);
    expect(dhaka11.body.views.total).toBe(1);

    const long = await getAnalytics(pl.id, "range=custom&from=2024-01-01&to=2024-06-30&tz=UTC");
    expect(long.body.range.granularity).toBe("week");
    expect(long.body.series.reduce((a: number, p: { views: number }) => a + p.views, 0)).toBe(2);
    expect(long.body.series.every((p: { date: string }) => new Date(`${p.date}T00:00:00Z`).getUTCDay() === 1)).toBe(true);
  });
});
