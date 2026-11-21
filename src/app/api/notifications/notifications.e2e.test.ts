import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { channels, files, notifications, users, withdrawals, transactions } from "@/db/schema";
import { createSession } from "@/lib/auth";
import { finalizeVerifiedChannelConnection } from "@/lib/channelConnection";
import { MAX_NOTIFICATIONS_PER_USER, notifyUser } from "@/lib/notifications";
import { GET } from "./route";
import { POST as markRead } from "./read/route";
import { PATCH as patchFile } from "../files/[id]/route";
import { POST as withdraw } from "../wallet/withdraw/route";
import { DELETE as deleteChannel } from "../channels/route";

/**
 * DATABASE-BACKED integration test (real Postgres, real route handlers, real session cookies).
 * It does NOT talk to Telegram and is not a device test.
 */
const tag = `ntf${Date.now()}`;
let userA = 0;
let userB = 0;
let tokenA = "";
let tokenB = "";
const created: number[] = [];

function req(path: string, init: { method?: string; token?: string; json?: unknown } = {}) {
  const headers: Record<string, string> = { host: "localhost" };
  if (init.token) headers.cookie = `onfile_session=${init.token}`;
  if (init.json !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(`http://localhost${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
  });
}
const list = async (token?: string) => GET(req("/api/notifications", { token }));
const summary = async (token?: string) => GET(req("/api/notifications?summary=1", { token }));
const read = (json: unknown, token?: string) => markRead(req("/api/notifications/read", { method: "POST", token, json }));
const idCtx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });

async function makeUser(n: string) {
  const [u] = await db
    .insert(users)
    .values({ telegramId: `${tag}${n}`, referralCode: `${tag}${n}`.slice(-8).toUpperCase(), balance: "50" })
    .returning();
  created.push(u.id);
  const s = await createSession(u.id);
  return { id: u.id, token: s.token };
}

beforeAll(async () => {
  const a = await makeUser("a");
  const b = await makeUser("b");
  userA = a.id;
  tokenA = a.token;
  userB = b.id;
  tokenB = b.token;
});
beforeEach(async () => {
  await db.delete(notifications).where(inArray(notifications.userId, [userA, userB]));
});
afterAll(async () => {
  await db.delete(withdrawals).where(inArray(withdrawals.userId, created));
  await db.delete(transactions).where(inArray(transactions.userId, created));
  await db.delete(files).where(inArray(files.userId, created));
  await db.delete(channels).where(inArray(channels.userId, created));
  await db.delete(users).where(inArray(users.id, created)); // notifications cascade
});

describe("GET /api/notifications", () => {
  it("401 without a session (also for the summary call)", async () => {
    expect((await list()).status).toBe(401);
    expect((await summary()).status).toBe(401);
  });

  it("empty state: no notifications, unreadCount 0", async () => {
    const res = await list(tokenA);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ notifications: [], unreadCount: 0 });
  });

  it("lists ONLY the authenticated user's notifications, newest first, without internal ids", async () => {
    await notifyUser({ userId: userA, type: "wallet" as never, title: "first", body: "b1" });
    await new Promise((r) => setTimeout(r, 15));
    await notifyUser({ userId: userA, type: "file_published", title: "second", body: "b2" });
    await notifyUser({ userId: userB, type: "file_published", title: "B only", body: "secret" });

    const body = await (await list(tokenA)).json();
    expect(body.notifications.map((n: { title: string }) => n.title)).toEqual(["second", "first"]);
    expect(body.unreadCount).toBe(2);
    expect(JSON.stringify(body)).not.toContain("B only");
    const n = body.notifications[0];
    expect(Object.keys(n).sort()).toEqual(["body", "createdAt", "destination", "id", "read", "title", "type"]);
    expect(typeof n.id).toBe("string");
    expect(n.id.length).toBeGreaterThanOrEqual(10); // opaque public id, not the serial
    expect(n.read).toBe(false);
    expect(new Date(n.createdAt).getTime()).not.toBeNaN();
  });

  it("unread count is correct and cheap summary matches", async () => {
    for (let i = 0; i < 3; i++) await notifyUser({ userId: userA, type: "file_published", title: `t${i}`, body: "b" });
    expect(await (await summary(tokenA)).json()).toEqual({ unreadCount: 3 });
    expect(await (await summary(tokenB)).json()).toEqual({ unreadCount: 0 });
  });
});

describe("POST /api/notifications/read", () => {
  it("401 unauthenticated, 403 cross-origin, 400 invalid bodies", async () => {
    expect((await read({ all: true })).status).toBe(401);
    const cross = new NextRequest("http://localhost/api/notifications/read", {
      method: "POST",
      headers: { host: "localhost", origin: "https://evil.example", cookie: `onfile_session=${tokenA}`, "content-type": "application/json" },
      body: JSON.stringify({ all: true }),
    });
    expect((await markRead(cross)).status).toBe(403);
    expect((await read({}, tokenA)).status).toBe(400);
    expect((await read({ id: 123 }, tokenA)).status).toBe(400);
    expect((await read({ id: "../../etc" }, tokenA)).status).toBe(400);
    expect((await read({ id: "abcdefghijk", all: true }, tokenA)).status).toBe(400);
    expect((await read({ all: "yes" }, tokenA)).status).toBe(400);
    expect((await read([1, 2], tokenA)).status).toBe(400);
  });

  it("marks ONE notification read and returns the updated unread count", async () => {
    await notifyUser({ userId: userA, type: "file_published", title: "one", body: "b" });
    await notifyUser({ userId: userA, type: "file_published", title: "two", body: "b" });
    const { notifications: items } = await (await list(tokenA)).json();
    const res = await read({ id: items[0].id }, tokenA);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ updated: 1, unreadCount: 1 });
    // idempotent
    expect(await (await read({ id: items[0].id }, tokenA)).json()).toEqual({ updated: 0, unreadCount: 1 });
    const after = await (await list(tokenA)).json();
    expect(after.notifications.filter((n: { read: boolean }) => n.read)).toHaveLength(1);
  });

  it("mark-all-as-read clears the unread count", async () => {
    for (let i = 0; i < 4; i++) await notifyUser({ userId: userA, type: "file_published", title: `t${i}`, body: "b" });
    const res = await read({ all: true }, tokenA);
    expect(await res.json()).toEqual({ updated: 4, unreadCount: 0 });
    expect(await (await read({ all: true }, tokenA)).json()).toEqual({ updated: 0, unreadCount: 0 });
  });

  it("one user can NEVER read or mark another user's notifications (404, nothing changes)", async () => {
    await notifyUser({ userId: userB, type: "file_published", title: "B private", body: "b" });
    const bItems = (await (await list(tokenB)).json()).notifications;
    const res = await read({ id: bItems[0].id }, tokenA);
    expect(res.status).toBe(404);
    expect(await (await summary(tokenB)).json()).toEqual({ unreadCount: 1 });

    // "mark all" by A must not touch B either
    await notifyUser({ userId: userA, type: "file_published", title: "A one", body: "b" });
    await read({ all: true }, tokenA);
    expect(await (await summary(tokenB)).json()).toEqual({ unreadCount: 1 });
    expect((await list(tokenA)).status).toBe(200);
    expect(JSON.stringify(await (await list(tokenA)).json())).not.toContain("B private");
  });
});

describe("destinations", () => {
  it("a file destination is available while the file exists and becomes unavailable once deleted", async () => {
    const [f] = await db
      .insert(files)
      .values({ userId: userA, title: "Doc", fileType: "document", telegramMessageLink: `https://t.me/c/1/${tag}`, smartLinkSlug: `${tag}-f1`, isPublished: true })
      .returning();
    await notifyUser({ userId: userA, type: "file_published", title: "pub", body: "b", destination: { type: "file", ref: f.id } });
    let n = (await (await list(tokenA)).json()).notifications[0];
    expect(n.destination).toEqual({ type: "file", available: true });
    expect(JSON.stringify(n)).not.toContain(String(f.id) + '"'); // the ref id is never exposed

    await db.delete(files).where(eq(files.id, f.id));
    n = (await (await list(tokenA)).json()).notifications[0];
    expect(n.destination).toEqual({ type: "file", available: false });
  });

  it("a file destination pointing at ANOTHER user's file is reported unavailable", async () => {
    const [f] = await db
      .insert(files)
      .values({ userId: userB, title: "B doc", fileType: "document", telegramMessageLink: `https://t.me/c/2/${tag}`, smartLinkSlug: `${tag}-f2`, isPublished: true })
      .returning();
    await notifyUser({ userId: userA, type: "file_published", title: "x", body: "b", destination: { type: "file", ref: f.id } });
    const n = (await (await list(tokenA)).json()).notifications[0];
    expect(n.destination).toEqual({ type: "file", available: false });
  });

  it("channels / wallet destinations carry no ref and are always available; no destination → null", async () => {
    await notifyUser({ userId: userA, type: "channel_connected", title: "c", body: "b", destination: { type: "channels" } });
    await notifyUser({ userId: userA, type: "withdrawal_requested", title: "w", body: "b", destination: { type: "wallet" } });
    await notifyUser({ userId: userA, type: "channel_disconnected", title: "n", body: "b" });
    const items = (await (await list(tokenA)).json()).notifications;
    const by = Object.fromEntries(items.map((n: { title: string }) => [n.title, n]));
    expect(by.c.destination).toEqual({ type: "channels", available: true });
    expect(by.w.destination).toEqual({ type: "wallet", available: true });
    expect(by.n.destination).toBeNull();
  });
});

describe("notifyUser", () => {
  it("dedupe key makes the same event idempotent; invalid input is ignored; never throws", async () => {
    expect(await notifyUser({ userId: userA, type: "file_published", title: "t", body: "b", dedupeKey: "k1" })).toBe(true);
    expect(await notifyUser({ userId: userA, type: "file_published", title: "t", body: "b", dedupeKey: "k1" })).toBe(false);
    expect(await notifyUser({ userId: userB, type: "file_published", title: "t", body: "b", dedupeKey: "k1" })).toBe(true); // per-user
    expect(await notifyUser({ userId: 0, type: "file_published", title: "t", body: "b" })).toBe(false);
    expect(await notifyUser({ userId: userA, type: "file_published", title: "  ", body: "b" })).toBe(false);
    expect(await notifyUser({ userId: 2_000_000_000, type: "file_published", title: "t", body: "b" })).toBe(false); // FK violation swallowed
  });

  it("sanitises control characters and clamps length", async () => {
    await notifyUser({ userId: userA, type: "file_published", title: "Hi\u0000\nthere", body: "x".repeat(900) });
    const n = (await (await list(tokenA)).json()).notifications[0];
    expect(n.title).toBe("Hi there");
    expect(n.body.length).toBeLessThanOrEqual(400);
  });

  it("keeps only the newest MAX_NOTIFICATIONS_PER_USER", async () => {
    await db.insert(notifications).values(
      Array.from({ length: MAX_NOTIFICATIONS_PER_USER }, (_, i) => ({
        publicId: `${tag}-old-${i}`.slice(0, 24),
        userId: userA,
        type: "file_published",
        title: "old",
        body: "b",
        createdAt: new Date(Date.now() - 1_000_000 - i * 1000),
      }))
    );
    await notifyUser({ userId: userA, type: "file_published", title: "newest", body: "b" });
    const rows = await db.select().from(notifications).where(eq(notifications.userId, userA));
    expect(rows).toHaveLength(MAX_NOTIFICATIONS_PER_USER);
    expect(rows.some((r) => r.title === "newest")).toBe(true);
  });
});

describe("genuine backend events create notifications for the right user", () => {
  it("channel verified + persisted → 'Channel connected' (for the owner only)", async () => {
    const chatId = `-100${Date.now()}`;
    const result = await finalizeVerifiedChannelConnection(
      { ok: true, chat: { id: chatId, title: "My Private", type: "channel" } } as never,
      { telegramUserId: Number(`9${Date.now()}`.slice(0, 9)), sessionUserId: userA, telegramProfile: null },
      null,
      { createSessionForNewAccount: false }
    );
    expect(result.ok).toBe(true);
    const a = (await (await list(tokenA)).json()).notifications;
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ type: "channel_connected", title: "Channel connected", read: false, destination: { type: "channels", available: true } });
    expect(a[0].body).toContain("My Private");
    expect((await (await list(tokenB)).json()).notifications).toHaveLength(0);
  });

  it("DELETE channel → 'Channel disconnected' for the owner; another user's attempt is 404 and creates nothing", async () => {
    const [ch] = await db
      .insert(channels)
      .values({ userId: userA, telegramChannelId: `-100${tag}`, channelName: "Gone", status: "verified", isVerified: true, botIsAdmin: true })
      .returning();
    const del = (token: string) =>
      deleteChannel(new NextRequest(`http://localhost/api/channels?id=${ch.id}`, { method: "DELETE", headers: { host: "localhost", cookie: `onfile_session=${token}` } }));
    expect((await del(tokenB)).status).toBe(404);
    expect((await (await list(tokenB)).json()).notifications).toHaveLength(0);
    expect((await del(tokenA)).status).toBe(200);
    const a = (await (await list(tokenA)).json()).notifications;
    expect(a[0]).toMatchObject({ type: "channel_disconnected", title: "Channel disconnected" });
  });

  it("draft → published (PATCH) notifies once; edits of an already published file do not", async () => {
    const [f] = await db
      .insert(files)
      .values({ userId: userA, title: "Draft", fileType: "document", telegramMessageLink: `https://t.me/c/3/${tag}`, smartLinkSlug: `${tag}-f3`, isPublished: false })
      .returning();
    const patch = (json: unknown) =>
      patchFile(
        new NextRequest(`http://localhost/api/files/${f.id}`, { method: "PATCH", headers: { host: "localhost", cookie: `onfile_session=${tokenA}`, "content-type": "application/json" }, body: JSON.stringify(json) }),
        idCtx(f.id)
      );
    expect((await patch({ title: "Renamed" })).status).toBe(200);
    expect((await (await list(tokenA)).json()).notifications).toHaveLength(0); // no event → no notification
    expect((await patch({ isPublished: true })).status).toBe(200);
    expect((await patch({ isPublished: true })).status).toBe(200);
    const a = (await (await list(tokenA)).json()).notifications;
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ type: "file_published", title: "File published", destination: { type: "file", available: true } });
  });

  it("withdrawal request → 'Withdrawal requested'", async () => {
    const res = await withdraw(
      new NextRequest("http://localhost/api/wallet/withdraw", {
        method: "POST",
        headers: { host: "localhost", cookie: `onfile_session=${tokenA}`, "content-type": "application/json", "x-forwarded-for": `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` },
        body: JSON.stringify({ amount: 5, walletAddress: "TXyz1234567890abcdef", network: "TRC20", currency: "USDT" }),
      })
    );
    expect(res.status).toBe(201);
    const a = (await (await list(tokenA)).json()).notifications;
    expect(a[0]).toMatchObject({ type: "withdrawal_requested", destination: { type: "wallet", available: true } });
    expect(a[0].body).toContain("5.00 USDT");
  });
});
