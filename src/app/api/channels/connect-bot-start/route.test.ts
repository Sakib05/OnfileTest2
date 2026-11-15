import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { botPrivateChats, pendingChannelRequests } from "@/db/schema";
import { POST } from "./route";
import { createSetupToken, SETUP_COOKIE_NAME } from "@/lib/setupToken";
import { recordPrivateChat } from "@/lib/botPrivateChats";
import { verifyBotStartPayload } from "@/lib/botConnectFlow";
import { createPendingChannelRequest, getRequestByToken } from "@/lib/pendingChannelRequests";

/**
 * "Connect" (POST /api/channels/connect-bot-start): starts the SERVER-SIDE 10-minute window,
 * delivers the welcome + native picker message exactly once, and refuses expired / foreign /
 * finished requests. Real Postgres; only the Telegram Bot API is mocked.
 */

const USER = 900_800_001;
const OTHER = 900_800_002;
const PRIVATE_CHAT = 700_800_001;
const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
let ip = 0;
let sent: { method: string; body: Record<string, unknown> }[] = [];

const cookie = (id: number) => `${SETUP_COOKIE_NAME}=${createSetupToken({ id, first_name: "T" })}`;
function connectReq(token: unknown, asUser: number | null = USER, extra: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/channels/connect-bot-start", {
    method: "POST",
    headers: {
      host: "localhost",
      "content-type": "application/json",
      "x-forwarded-for": `10.33.0.${++ip}`,
      ...(asUser ? { cookie: cookie(asUser) } : {}),
      ...extra,
    },
    body: JSON.stringify({ token }),
  });
}
const prepared = (user = USER) =>
  createPendingChannelRequest({ telegramUserId: user, sessionUserId: null, telegramProfile: { first_name: "T" } }, { method: "bot" });
const messages = () => sent.filter((c) => c.method === "sendMessage");

async function cleanup() {
  await db.delete(pendingChannelRequests).where(inArray(pendingChannelRequests.telegramUserId, [String(USER), String(OTHER)]));
  await db.delete(botPrivateChats).where(inArray(botPrivateChats.telegramUserId, [String(USER), String(OTHER)]));
}

beforeEach(async () => {
  process.env.TELEGRAM_BOT_TOKEN = "test-token-connect-bot-start";
  sent = [];
  global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const method = String(url).split("/").pop() as string;
    sent.push({ method, body: init?.body ? JSON.parse(init.body as string) : {} });
    const result = method === "getMe" ? { id: 555, username: "ConfiguredOnfileBot" } : method === "sendMessage" ? { message_id: 1 } : true;
    return new Response(JSON.stringify({ ok: true, result }), { status: 200 });
  }) as unknown as typeof fetch;
  await cleanup();
});
afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  process.env.TELEGRAM_BOT_TOKEN = ORIGINAL_TOKEN;
});
afterAll(cleanup);

describe("POST /api/channels/connect-bot-start", () => {
  it("rejects cross-origin (403), missing body token (400) and anonymous callers (401)", async () => {
    const { correlationToken } = await prepared();
    expect((await POST(connectReq(correlationToken, USER, { origin: "https://evil.example" }))).status).toBe(403);
    expect((await POST(connectReq(undefined))).status).toBe(400);
    expect((await POST(connectReq(correlationToken, null))).status).toBe(401);
    expect((await getRequestByToken(correlationToken))?.lifecycle).toBe("prepared"); // nothing started
  });

  it("Connect starts the server-side 10-minute window and returns the server-authoritative expiry", async () => {
    await recordPrivateChat(USER, PRIVATE_CHAT, "webhook");
    const { correlationToken } = await prepared();
    // The prepared request has NOT started a countdown: make its stored expiry visibly different.
    const before = await getRequestByToken(correlationToken);
    await db.update(pendingChannelRequests).set({ expiresAt: new Date(Date.now() + 60_000) }).where(eq(pendingChannelRequests.id, before!.id));

    const t0 = Date.now();
    const res = await POST(connectReq(correlationToken));
    expect(res.status).toBe(200);
    const data = await res.json();

    const expiresAt = Date.parse(data.expiresAt);
    expect(expiresAt - t0).toBeGreaterThan(9.9 * 60_000);
    expect(expiresAt - t0).toBeLessThanOrEqual(10 * 60_000 + 5_000);
    expect(Math.abs(Date.parse(data.serverTime) - Date.now())).toBeLessThan(5_000);

    const after = await getRequestByToken(correlationToken);
    expect(after?.connectStartedAt).toBeInstanceOf(Date);
    expect(after?.expiresAt.getTime()).toBe(expiresAt);
    expect(after?.lifecycle).toBe("awaiting_channel_selection");
  });

  it("delivers the welcome message + native channel picker for THIS request, to the verified chat (not the user id)", async () => {
    await recordPrivateChat(USER, PRIVATE_CHAT, "webhook");
    const { correlationToken, telegramRequestId } = await prepared();
    const data = await (await POST(connectReq(correlationToken))).json();

    expect(data.mode).toBe("existing_chat");
    expect(data.botUrl).toBe("https://t.me/ConfiguredOnfileBot"); // plain link: no ?start=, no /start spam
    expect(messages()).toHaveLength(1);
    const msg = messages()[0].body;
    expect(String(msg.chat_id)).toBe(String(PRIVATE_CHAT));
    expect(String(msg.text)).toContain("Welcome to Onfile Channel Connection!");
    expect(String(msg.text)).toContain("private Telegram channel");
    expect(String(msg.text)).toContain("expire in 10 minutes");
    const button = (msg.reply_markup as { keyboard: { request_chat: Record<string, unknown> }[][] }).keyboard[0][0].request_chat;
    expect(button.request_id).toBe(telegramRequestId);
    expect(button.chat_is_channel).toBe(true);
    expect(button.chat_has_username).toBe(false);
    expect(button.bot_administrator_rights).toMatchObject({ can_post_messages: true });
    expect(button.user_administrator_rights).toMatchObject({ can_post_messages: true });
  });

  it("repeating Connect (retry / double tap) never sends a second message and never extends the window", async () => {
    await recordPrivateChat(USER, PRIVATE_CHAT, "webhook");
    const { correlationToken } = await prepared();
    const first = await (await POST(connectReq(correlationToken))).json();
    const second = await (await POST(connectReq(correlationToken))).json();
    expect(messages()).toHaveLength(1);
    expect(second.expiresAt).toBe(first.expiresAt);
  });

  it("two concurrent Connect calls deliver exactly one message", async () => {
    await recordPrivateChat(USER, PRIVATE_CHAT, "webhook");
    const { correlationToken } = await prepared();
    const [a, b] = await Promise.all([POST(connectReq(correlationToken)), POST(connectReq(correlationToken))]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(messages()).toHaveLength(1);
  });

  it("first-time user: no message is sent; the signed Start link is returned and bound to this user + request", async () => {
    global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const method = String(url).split("/").pop() as string;
      sent.push({ method, body: init?.body ? JSON.parse(init.body as string) : {} });
      if (method === "getMe") return new Response(JSON.stringify({ ok: true, result: { id: 555, username: "ConfiguredOnfileBot" } }));
      return new Response(JSON.stringify({ ok: false, error_code: 400, description: "Bad Request: chat not found" }), { status: 400 });
    }) as unknown as typeof fetch;
    const { correlationToken, telegramRequestId } = await prepared();
    const data = await (await POST(connectReq(correlationToken))).json();
    expect(data.mode).toBe("start_link");
    expect(data.botUrl).toMatch(/^https:\/\/t\.me\/ConfiguredOnfileBot\?start=c1_[0-9a-z]+_[0-9a-f]{24}$/);
    const payload = new URL(data.botUrl).searchParams.get("start")!;
    expect(verifyBotStartPayload(payload, USER)).toEqual({ ok: true, requestId: telegramRequestId });
    expect(verifyBotStartPayload(payload, OTHER).ok).toBe(false);
    expect(messages()).toHaveLength(0);
    // Countdown IS running (Connect was tapped); the webhook delivers the picker after /start.
    expect((await getRequestByToken(correlationToken))?.lifecycle).toBe("connecting");
  });

  it("another Telegram user's token is indistinguishable from an unknown one — nothing is started or sent", async () => {
    const { correlationToken } = await prepared(USER);
    const res = await POST(connectReq(correlationToken, OTHER));
    expect(res.status).toBe(404);
    expect((await res.json()).status).toBe("expired");
    expect((await getRequestByToken(correlationToken))?.connectStartedAt).toBeNull();
    expect(messages()).toHaveLength(0);
    expect((await POST(connectReq("not-a-real-token"))).status).toBe(404);
  });

  it("an expired request can never be started (410, nothing sent)", async () => {
    await recordPrivateChat(USER, PRIVATE_CHAT, "webhook");
    const { correlationToken } = await prepared();
    const row = (await getRequestByToken(correlationToken))!;
    await db.update(pendingChannelRequests).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(pendingChannelRequests.id, row.id));
    const res = await POST(connectReq(correlationToken));
    expect(res.status).toBe(410);
    expect((await res.json()).status).toBe("expired");
    expect(messages()).toHaveLength(0);
  });

  it("a superseded (cancelled) or already-resolved request can't be started", async () => {
    const { correlationToken } = await prepared();
    const row = (await getRequestByToken(correlationToken))!;
    await db.update(pendingChannelRequests).set({ status: "failed", failureReason: "cancelled" }).where(eq(pendingChannelRequests.id, row.id));
    const res = await POST(connectReq(correlationToken));
    expect(res.status).toBe(409);
    expect((await res.json()).state).toBe("cancelled");
  });
});
