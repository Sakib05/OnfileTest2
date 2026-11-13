import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { botPrivateChats, pendingChannelRequests } from "@/db/schema";
import { POST } from "./route";
import { createSetupToken, SETUP_COOKIE_NAME } from "@/lib/setupToken";
import { verifyBotStartPayload } from "@/lib/botConnectFlow";
import { getPrivateChat, recordPrivateChat } from "@/lib/botPrivateChats";
import { connectMethodForRequestId, getPendingByToken } from "@/lib/pendingChannelRequests";

/**
 * Returning-user flow: POST /api/channels/connect-bot-request sends the
 * "Select channel to connect" keyboard into the user's EXISTING private chat
 * (verified chat id from our store) and answers with the plain bot link — no
 * "?start=" — so Telegram posts no new "/start". Only the Telegram Bot API is
 * mocked; real Postgres is used. Needs a disposable DEV database.
 */

const TG_USER = 900_300_101;
const OTHER_USER = 900_300_102;
// Deliberately DIFFERENT from the user ids: a chat id must never be assumed equal to a user id.
const PRIVATE_CHAT = 700_300_101;
const OTHER_CHAT = 700_300_102;
const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
let ip = 0;

interface TgReply {
  ok: boolean;
  result?: unknown;
  error_code?: number;
  description?: string;
}
let replies: { getChat?: TgReply; sendMessage?: TgReply };
let calls: { method: string; body: Record<string, unknown> }[];

function installTelegramMock() {
  calls = [];
  global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const method = String(url).split("/").pop() as string;
    const body = init?.body ? JSON.parse(init.body as string) : {};
    calls.push({ method, body });
    let reply: TgReply;
    if (method === "getMe") reply = { ok: true, result: { id: 555, username: "ConfiguredOnfileBot" } };
    else if (method === "getChat") reply = replies.getChat ?? { ok: false, error_code: 400, description: "Bad Request: chat not found" };
    else if (method === "sendMessage") reply = replies.sendMessage ?? { ok: true, result: { message_id: 1 } };
    else reply = { ok: true, result: true };
    return new Response(JSON.stringify(reply), { status: reply.ok ? 200 : reply.error_code ?? 500 });
  }) as unknown as typeof fetch;
}
const sentMessages = () => calls.filter((c) => c.method === "sendMessage");

function req(init: { body?: unknown; query?: string } = {}) {
  return new NextRequest(`http://localhost/api/channels/connect-bot-request${init.query ?? ""}`, {
    method: "POST",
    headers: {
      host: "localhost",
      "x-forwarded-for": `10.31.0.${++ip}`,
      "content-type": "application/json",
      cookie: `${SETUP_COOKIE_NAME}=${createSetupToken({ id: TG_USER, first_name: "Tester" })}`,
    },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  });
}

async function cleanup() {
  await db.delete(pendingChannelRequests).where(inArray(pendingChannelRequests.telegramUserId, [String(TG_USER), String(OTHER_USER)]));
  await db.delete(botPrivateChats).where(inArray(botPrivateChats.telegramUserId, [String(TG_USER), String(OTHER_USER)]));
}

beforeEach(async () => {
  process.env.TELEGRAM_BOT_TOKEN = "test-token-existing-chat";
  replies = {};
  installTelegramMock();
  await cleanup();
});
afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  process.env.TELEGRAM_BOT_TOKEN = ORIGINAL_TOKEN;
});
afterAll(cleanup);

describe("returning user (verified private chat on file)", () => {
  beforeEach(async () => {
    await recordPrivateChat(TG_USER, PRIVATE_CHAT, "webhook");
  });

  it("sends the 'Select channel to connect' keyboard to the EXISTING chat id (not the user id) for the new pending request", async () => {
    const res = await POST(req());
    expect(res.status).toBe(200);
    const data = await res.json();

    const msgs = sentMessages();
    expect(msgs).toHaveLength(1);
    expect(String(msgs[0].body.chat_id)).toBe(String(PRIVATE_CHAT));
    expect(String(msgs[0].body.chat_id)).not.toBe(String(TG_USER));

    const markup = msgs[0].body.reply_markup as {
      keyboard: { text: string; request_chat: { request_id: number; chat_is_channel: boolean; chat_has_username: boolean } }[][];
    };
    const button = markup.keyboard[0][0];
    expect(button.text).toBe("Select channel to connect");
    expect(button.request_chat.chat_is_channel).toBe(true);
    expect(button.request_chat.chat_has_username).toBe(false); // private channels only

    // The keyboard is tied to exactly the pending request that was just created for this user.
    const pending = await getPendingByToken(data.token);
    expect(pending?.status).toBe("pending");
    expect(pending?.identity.telegramUserId).toBe(TG_USER);
    expect(connectMethodForRequestId(pending!.telegramRequestId)).toBe("bot");
    expect(button.request_chat.request_id).toBe(pending!.telegramRequestId);
  });

  it("returns the PLAIN bot chat link of the CONFIGURED bot — no '?start=' (so no new /start)", async () => {
    const data = await (await POST(req())).json();
    expect(data.mode).toBe("existing_chat");
    expect(data.botUrl).toBe("https://t.me/ConfiguredOnfileBot");
    expect(data.botUrl).not.toContain("?");
    expect(data.botUrl).not.toContain("start=");
    expect(data.botUsername).toBe("ConfiguredOnfileBot"); // from getMe, not hardcoded
    expect(JSON.stringify(data)).not.toContain("test-token-existing-chat"); // token never exposed
    expect(data.fallbackReason).toBeUndefined();
    // No Telegram probe was needed: the stored association was used.
    expect(calls.some((c) => c.method === "getChat")).toBe(false);
  });

  it("ignores any chat id / user id supplied by the client", async () => {
    const res = await POST(req({ body: { chat_id: 12345, chatId: 12345, telegramUserId: OTHER_USER, userId: OTHER_USER }, query: "?chat_id=12345&user_id=1" }));
    expect(res.status).toBe(200);
    expect(sentMessages().map((m) => String(m.body.chat_id))).toEqual([String(PRIVATE_CHAT)]);
  });

  it("never uses another user's stored chat", async () => {
    await db.delete(botPrivateChats).where(eq(botPrivateChats.telegramUserId, String(TG_USER)));
    await recordPrivateChat(OTHER_USER, OTHER_CHAT, "webhook");
    const data = await (await POST(req())).json();
    expect(sentMessages().some((m) => String(m.body.chat_id) === String(OTHER_CHAT))).toBe(false);
    expect(data.mode).toBe("start_link");
  });

  it("repeated taps keep exactly ONE live bot request (earlier ones are superseded, no duplicates)", async () => {
    const a = await (await POST(req())).json();
    const b = await (await POST(req())).json();
    expect(a.token).not.toBe(b.token);
    expect((await getPendingByToken(a.token))?.status).toBe("failed");
    expect((await getPendingByToken(a.token))?.failureReason).toBe("cancelled");
    expect((await getPendingByToken(b.token))?.status).toBe("pending");
    const live = await db
      .select()
      .from(pendingChannelRequests)
      .where(and(eq(pendingChannelRequests.telegramUserId, String(TG_USER)), eq(pendingChannelRequests.status, "pending")));
    expect(live).toHaveLength(1);
  });

  it("a user who blocked the bot → falls back to the signed start link and the chat is marked blocked", async () => {
    replies.sendMessage = { ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" };
    const data = await (await POST(req())).json();
    expect(data.mode).toBe("start_link");
    expect(data.fallbackReason).toBe("bot_blocked");
    expect((await getPrivateChat(TG_USER))?.status).toBe("blocked");
    const payload = new URL(data.botUrl).searchParams.get("start")!;
    expect(verifyBotStartPayload(payload, TG_USER).ok).toBe(true);
  });

  it("a previously blocked chat whose user unblocked the bot works again (sendMessage is the authority)", async () => {
    await db.update(botPrivateChats).set({ status: "blocked" }).where(eq(botPrivateChats.telegramUserId, String(TG_USER)));
    const data = await (await POST(req())).json();
    expect(data.mode).toBe("existing_chat");
    expect((await getPrivateChat(TG_USER))?.status).toBe("active");
  });

  it("'can't initiate conversation' (never started) → signed start link, stale association removed", async () => {
    replies.sendMessage = { ok: false, error_code: 403, description: "Forbidden: bot can't initiate conversation with a user" };
    const data = await (await POST(req())).json();
    expect(data.mode).toBe("start_link");
    expect(data.fallbackReason).toBe("no_chat");
    expect(await getPrivateChat(TG_USER)).toBeNull();
  });

  it("'chat not found' for the stored chat → signed start link, invalid association removed", async () => {
    replies.sendMessage = { ok: false, error_code: 400, description: "Bad Request: chat not found" };
    const data = await (await POST(req())).json();
    expect(data.mode).toBe("start_link");
    expect(data.fallbackReason).toBe("chat_invalid");
    expect(await getPrivateChat(TG_USER)).toBeNull();
  });

  it("a transient Telegram error → 502, request cancelled, NO start-link fallback (it would cause a /start)", async () => {
    replies.sendMessage = { ok: false, error_code: 500, description: "Internal Server Error" };
    const res = await POST(req());
    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.reason).toBe("telegram_api_error");
    expect(data.botUrl).toBeUndefined();
    expect(data.token).toBeUndefined();
    const live = await db
      .select()
      .from(pendingChannelRequests)
      .where(and(eq(pendingChannelRequests.telegramUserId, String(TG_USER)), eq(pendingChannelRequests.status, "pending")));
    expect(live).toHaveLength(0);
    // The association is untouched by a transient error.
    expect((await getPrivateChat(TG_USER))?.status).toBe("active");
  });
});

describe("user without a stored private chat", () => {
  it("asks Telegram (getChat); a confirmed private chat is used, recorded, and the keyboard is sent there", async () => {
    replies.getChat = { ok: true, result: { id: PRIVATE_CHAT, type: "private", first_name: "T" } };
    const data = await (await POST(req())).json();
    expect(calls.filter((c) => c.method === "getChat")).toHaveLength(1);
    expect(data.mode).toBe("existing_chat");
    expect(data.botUrl).toBe("https://t.me/ConfiguredOnfileBot");
    expect(String(sentMessages()[0].body.chat_id)).toBe(String(PRIVATE_CHAT));
    expect(await getPrivateChat(TG_USER)).toMatchObject({ chatId: String(PRIVATE_CHAT), source: "get_chat", status: "active" });
  });

  it("first-time user (Telegram has no chat) → signed Start flow, nothing is sent", async () => {
    replies.getChat = { ok: false, error_code: 400, description: "Bad Request: chat not found" };
    const data = await (await POST(req())).json();
    expect(data.mode).toBe("start_link");
    expect(data.fallbackReason).toBe("no_chat");
    expect(data.botUrl).toMatch(/^https:\/\/t\.me\/ConfiguredOnfileBot\?start=c1_[0-9a-z]+_[0-9a-f]{24}$/);
    expect(sentMessages()).toHaveLength(0);

    const payload = new URL(data.botUrl).searchParams.get("start")!;
    const verified = verifyBotStartPayload(payload, TG_USER);
    expect(verified.ok).toBe(true);
    expect(verifyBotStartPayload(payload, TG_USER + 1).ok).toBe(false); // user-bound HMAC
    const pending = await getPendingByToken(data.token);
    expect(verified.ok && verified.requestId).toBe(pending!.telegramRequestId);
    expect(pending?.status).toBe("pending");
  });

  it("a getChat answer that is not a private chat is never trusted", async () => {
    replies.getChat = { ok: true, result: { id: -100123, type: "channel" } };
    const data = await (await POST(req())).json();
    expect(data.mode).toBe("start_link");
    expect(await getPrivateChat(TG_USER)).toBeNull();
    expect(sentMessages()).toHaveLength(0);
  });

  it("Telegram unreachable during the probe → retryable 502, not a silent start-link fallback", async () => {
    replies.getChat = { ok: false, error_code: 502, description: "Bad Gateway" };
    const res = await POST(req());
    expect(res.status).toBe(502);
    expect((await res.json()).botUrl).toBeUndefined();
  });

  it("first-time requests still never create more than one live request", async () => {
    await POST(req());
    await POST(req());
    const live = await db
      .select()
      .from(pendingChannelRequests)
      .where(and(eq(pendingChannelRequests.telegramUserId, String(TG_USER)), eq(pendingChannelRequests.status, "pending")));
    expect(live).toHaveLength(1);
  });
});
