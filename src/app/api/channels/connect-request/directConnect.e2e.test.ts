import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { channels, pendingChannelRequests, telegramUpdateLog, users } from "@/db/schema";
import { POST as CONNECT_REQUEST } from "./route";
import { POST as WEBHOOK } from "@/app/api/telegram/webhook/route";
import { GET as STATUS } from "@/app/api/channels/connect-status/route";
import { POST as CANCEL } from "@/app/api/channels/connect-cancel/route";
import { createSetupToken, SETUP_COOKIE_NAME } from "@/lib/setupToken";
import { CHANNEL_FAILURE_MESSAGES } from "@/lib/channelConnection";
import { buildRequestChatCriteria, REQUIRED_BOT_ADMIN_RIGHTS, REQUIRED_USER_ADMIN_RIGHTS } from "@/lib/telegramBot";
import {
  connectMethodForRequestId,
  createPendingChannelRequest,
  getPendingByToken,
  getRequestByToken,
  recordChannelSelection,
} from "@/lib/pendingChannelRequests";

/**
 * End-to-end tests of the DIRECT Mini App connection flow (Telegram `requestChat`, Bot API 9.6+):
 *   POST /api/channels/connect-request  →  (native picker, simulated)  →  `chat_shared` webhook  →  backend
 *   verification  →  GET /api/channels/connect-status.
 * Real route handlers + real Postgres; ONLY the Telegram Bot API (fetch) is mocked. Needs a DEV database.
 *
 * NOTE (ordering): the two "outage" tests run FIRST on purpose — telegramBot.ts caches the bot's own id after the
 * first successful `getMe`, and they need a cold cache to simulate Telegram being unreachable.
 */

const USER_A = 900_800_001;
const USER_B = 900_800_002;
const NEW_USER = 900_800_003;
const CHAT_ID = -1_009_800_000_001;
const OTHER_CHAT_ID = -1_009_800_000_002;
const BOT_ID = 999_002;
const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_ENV = { token: process.env.TELEGRAM_BOT_TOKEN, secret: process.env.TELEGRAM_WEBHOOK_SECRET };

interface Scenario {
  chat: { id: number; type: string; title?: string; username?: string };
  botMember: { status: string; can_post_messages?: boolean };
  userMember: { status: string };
  /** Bot API methods that fail, with how many more times they should fail (Infinity = always). */
  failing: Record<string, number>;
  preparedFails: boolean;
}
let scenario: Scenario;
let sent: { method: string; body: Record<string, unknown> }[] = [];
let updateIds: number[] = [];
let nextUpdateId = 8_800_000_000;
let accountA: number;
let ip = 0;

const privateChannel = (): Scenario => ({
  chat: { id: CHAT_ID, type: "channel", title: "My Private Channel" },
  botMember: { status: "administrator", can_post_messages: true },
  userMember: { status: "creator" },
  failing: {},
  preparedFails: false,
});

function installTelegramMock() {
  sent = [];
  global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const method = String(url).split("/").pop() as string;
    const body = init?.body ? JSON.parse(init.body as string) : {};
    sent.push({ method, body });
    if ((scenario.failing[method] ?? 0) > 0) {
      scenario.failing[method] -= 1;
      return new Response(JSON.stringify({ ok: false, error_code: 502, description: "Bad Gateway" }), { status: 502 });
    }
    let result: unknown = true;
    if (method === "getMe") result = { id: BOT_ID, username: "TestOnfileBot" };
    else if (method === "getChat") result = { ...scenario.chat, id: Number(body.chat_id) === OTHER_CHAT_ID ? OTHER_CHAT_ID : scenario.chat.id };
    else if (method === "getChatMember") result = body.user_id === BOT_ID ? scenario.botMember : scenario.userMember;
    else if (method === "savePreparedKeyboardButton") {
      if (scenario.preparedFails) {
        return new Response(JSON.stringify({ ok: false, error_code: 400, description: "Bad Request: BUTTON_TYPE_INVALID" }), { status: 400 });
      }
      result = { id: `prepared-${sent.length}` };
    }
    return new Response(JSON.stringify({ ok: true, result }), { status: 200 });
  }) as unknown as typeof fetch;
}

const cookieFor = (id: number) => `${SETUP_COOKIE_NAME}=${createSetupToken({ id, first_name: "T" })}`;

function connectRequest(asUser: number | null = USER_A, extraHeaders: Record<string, string> = {}) {
  return CONNECT_REQUEST(
    new NextRequest("http://localhost/api/channels/connect-request", {
      method: "POST",
      headers: { host: "localhost", "x-forwarded-for": `10.80.0.${++ip}`, ...(asUser ? { cookie: cookieFor(asUser) } : {}), ...extraHeaders },
    })
  );
}

function webhook(update: Record<string, unknown>) {
  const update_id = nextUpdateId++;
  updateIds.push(update_id);
  return WEBHOOK(
    new NextRequest("http://localhost/api/telegram/webhook", {
      method: "POST",
      body: JSON.stringify({ update_id, ...update }),
      headers: { host: "localhost", "content-type": "application/json" },
    })
  );
}
const chatSharedUpdate = (fromId: number, requestId: number, chatId = CHAT_ID) => ({
  message: { chat: { id: fromId, type: "private" }, from: { id: fromId }, chat_shared: { request_id: requestId, chat_id: chatId } },
});
const chatShared = (fromId: number, requestId: number, chatId = CHAT_ID) => webhook(chatSharedUpdate(fromId, requestId, chatId));

function status(token: string, asUser: number | null = USER_A) {
  return STATUS(
    new NextRequest(`http://localhost/api/channels/connect-status?token=${encodeURIComponent(token)}`, {
      headers: { host: "localhost", ...(asUser ? { cookie: cookieFor(asUser) } : {}) },
    })
  );
}
function cancel(body: Record<string, unknown>) {
  return CANCEL(
    new NextRequest("http://localhost/api/channels/connect-cancel", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { host: "localhost", "content-type": "application/json", "x-forwarded-for": `10.81.0.${++ip}` },
    })
  );
}

/** A direct request that exists exactly as /api/channels/connect-request would have created it. */
const newDirectRequest = (user = USER_A, sessionUserId: number | null = accountA) =>
  createPendingChannelRequest({ telegramUserId: user, sessionUserId, telegramProfile: null });

const connectedRows = () => db.select().from(channels).where(eq(channels.telegramChannelId, String(CHAT_ID)));
const botChatMessages = () => sent.filter((c) => c.method === "sendMessage");
const verificationCalls = () => sent.filter((c) => ["getChat", "getChatMember"].includes(c.method));

async function cleanup() {
  await db.delete(channels).where(inArray(channels.telegramChannelId, [String(CHAT_ID), String(OTHER_CHAT_ID)]));
  await db
    .delete(pendingChannelRequests)
    .where(inArray(pendingChannelRequests.telegramUserId, [String(USER_A), String(USER_B), String(NEW_USER)]));
  if (updateIds.length) await db.delete(telegramUpdateLog).where(inArray(telegramUpdateLog.updateId, updateIds));
  updateIds = [];
}

beforeEach(async () => {
  process.env.TELEGRAM_BOT_TOKEN = "test-token-direct-connect-e2e";
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
  scenario = privateChannel();
  installTelegramMock();
  await cleanup();
  await db.delete(users).where(eq(users.telegramId, String(NEW_USER)));
  const [u] = await db
    .insert(users)
    .values({ telegramId: String(USER_A), referralCode: "E2EDIR01" })
    .onConflictDoUpdate({ target: users.telegramId, set: { updatedAt: new Date() } })
    .returning();
  accountA = u.id;
});
afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  vi.restoreAllMocks();
});
afterAll(async () => {
  process.env.TELEGRAM_BOT_TOKEN = ORIGINAL_ENV.token;
  if (ORIGINAL_ENV.secret) process.env.TELEGRAM_WEBHOOK_SECRET = ORIGINAL_ENV.secret;
  await cleanup();
  await db.delete(channels).where(eq(channels.telegramChannelId, String(CHAT_ID)));
  await db.delete(users).where(inArray(users.telegramId, [String(USER_A), String(NEW_USER)]));
});

describe("Telegram outage during the automatic verification (runs first: needs a cold bot-id cache)", () => {
  it("a persistent outage is retried, then FAILS the request with a 'try again' reason — nothing connected, nothing sent to the chat", async () => {
    scenario.failing.getMe = Infinity;
    const { telegramRequestId, correlationToken } = await newDirectRequest();
    await chatShared(USER_A, telegramRequestId);

    const after = (await getRequestByToken(correlationToken))!;
    expect(after.status).toBe("failed");
    expect(after.failureReason).toBe("telegram_api_error");
    expect(sent.filter((c) => c.method === "getMe").length).toBe(3); // 3 attempts in total
    expect(await connectedRows()).toHaveLength(0);
    expect(botChatMessages()).toHaveLength(0);

    const data = await (await status(correlationToken)).json();
    expect(data).toMatchObject({ status: "failed", reason: "telegram_api_error" });
  });

  it("a brief outage is retried transparently and the channel still gets connected", async () => {
    scenario.failing.getMe = 2;
    const { telegramRequestId, correlationToken } = await newDirectRequest();
    await chatShared(USER_A, telegramRequestId);

    expect((await getRequestByToken(correlationToken))!.status).toBe("verified");
    expect(await connectedRows()).toHaveLength(1);
    expect(botChatMessages()).toHaveLength(0);
  });
});

describe("POST /api/channels/connect-request — the Connect button of a requestChat-capable client", () => {
  it("401 without an authenticated Telegram user — no request is created, Telegram is not called", async () => {
    const res = await connectRequest(null);
    expect(res.status).toBe(401);
    expect(await db.select().from(pendingChannelRequests).where(eq(pendingChannelRequests.telegramUserId, String(USER_A)))).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it("403 for a cross-origin request", async () => {
    const res = await connectRequest(USER_A, { origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect(sent).toHaveLength(0);
  });

  it("503 when the bot token is not configured", async () => {
    const cookie = cookieFor(USER_A);
    delete process.env.TELEGRAM_BOT_TOKEN;
    const res = await CONNECT_REQUEST(
      new NextRequest("http://localhost/api/channels/connect-request", {
        method: "POST",
        headers: { host: "localhost", "x-forwarded-for": `10.80.1.${++ip}`, cookie },
      })
    );
    expect(res.status).toBe(503);
  });

  it("prepares a PRIVATE-channel-only, admin-rights-restricted button for exactly the authenticated user, bound to the pending request", async () => {
    const res = await connectRequest(USER_A);
    expect(res.status).toBe(200);
    const data = await res.json();

    // Only the opaque polling token and the prepared button id leave the server.
    expect(Object.keys(data).sort()).toEqual(["preparedButtonId", "token"]);
    expect(typeof data.preparedButtonId).toBe("string");

    const pending = (await getPendingByToken(data.token))!;
    expect(connectMethodForRequestId(pending.telegramRequestId)).toBe("direct");
    expect(pending.identity.telegramUserId).toBe(USER_A);
    expect(pending.status).toBe("pending");
    const ttl = pending.expiresAt.getTime() - Date.now();
    expect(ttl).toBeGreaterThan(9 * 60_000);
    expect(ttl).toBeLessThanOrEqual(10 * 60_000);

    const prepared = sent.filter((c) => c.method === "savePreparedKeyboardButton");
    expect(prepared).toHaveLength(1);
    const body = prepared[0].body as { user_id: number; button: { request_chat: Record<string, unknown> } };
    expect(body.user_id).toBe(USER_A); // scoped to the authenticated user — not anything the client sent
    const criteria = body.button.request_chat;
    expect(criteria).toEqual(JSON.parse(JSON.stringify(buildRequestChatCriteria(pending.telegramRequestId)))); // same criteria as the legacy flow
    expect(criteria).toMatchObject({
      request_id: pending.telegramRequestId,
      chat_is_channel: true,
      chat_has_username: false,
      bot_administrator_rights: REQUIRED_BOT_ADMIN_RIGHTS,
      user_administrator_rights: REQUIRED_USER_ADMIN_RIGHTS,
    });
    expect(botChatMessages()).toHaveLength(0); // the old instruction message / reply keyboard is never sent
  });

  it("when Telegram refuses the prepared button: 502, and the unusable request is not left pending", async () => {
    scenario.preparedFails = true;
    const res = await connectRequest(USER_A);
    expect(res.status).toBe(502);
    const rows = await db.select().from(pendingChannelRequests).where(eq(pendingChannelRequests.telegramUserId, String(USER_A)));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "failed", failureReason: "cancelled" });
  });

  it("repeated taps: only the NEWEST request stays open; a legacy bot request is never touched", async () => {
    const legacy = await createPendingChannelRequest({ telegramUserId: USER_A, sessionUserId: accountA, telegramProfile: null }, { method: "bot" });
    const first = await (await connectRequest(USER_A)).json();
    const second = await (await connectRequest(USER_A)).json();
    const third = await (await connectRequest(USER_A)).json();

    expect((await getRequestByToken(first.token))!.status).toBe("failed");
    expect((await getRequestByToken(second.token))!.status).toBe("failed");
    expect((await getRequestByToken(third.token))!.status).toBe("pending");
    expect((await getRequestByToken(legacy.correlationToken))!.status).toBe("pending");

    // A late selection against a superseded request is ignored.
    const superseded = (await getRequestByToken(first.token))!;
    await chatShared(USER_A, superseded.telegramRequestId);
    expect(await connectedRows()).toHaveLength(0);
    expect(verificationCalls()).toHaveLength(0);
  });

  it("another user's tap never supersedes this user's request", async () => {
    const mine = await (await connectRequest(USER_A)).json();
    await connectRequest(USER_B);
    expect((await getRequestByToken(mine.token))!.status).toBe("pending");
  });
});

describe("chat_shared for a direct request — the BACKEND verifies and connects", () => {
  it("a verified private channel is connected to the right account; the status endpoint reports it; nothing goes to the bot chat", async () => {
    const { telegramRequestId, correlationToken } = await newDirectRequest();

    // Before any selection the status is plainly "pending" — opening the picker proves nothing.
    expect(await (await status(correlationToken)).json()).toMatchObject({ status: "pending", stage: "awaiting_selection" });

    await chatShared(USER_A, telegramRequestId);

    const rows = await connectedRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: accountA, status: "verified", botIsAdmin: true });
    // Live checks: the chat, the bot AND the user were all checked against Telegram.
    expect(sent.some((c) => c.method === "getChat" && String(c.body.chat_id) === String(CHAT_ID))).toBe(true);
    expect(sent.filter((c) => c.method === "getChatMember")).toHaveLength(2);
    expect(botChatMessages()).toHaveLength(0);

    const res = await status(correlationToken);
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.status).toBe("verified");
    expect(data.channel).toMatchObject({ status: "verified", telegramChannelId: String(CHAT_ID), userId: accountA });
  });

  it("a selection that is merely STORED (not verified) is never reported as success", async () => {
    const { telegramRequestId, correlationToken } = await newDirectRequest();
    await recordChannelSelection(USER_A, telegramRequestId, String(CHAT_ID)); // what the picker's result amounts to
    const data = await (await status(correlationToken)).json();
    expect(data).toMatchObject({ status: "pending", stage: "channel_selected" });
    expect(data.channel).toBeUndefined();
    expect(await connectedRows()).toHaveLength(0);
  });

  it("the Onfile bot lacks the post-messages right → failed, nothing connected", async () => {
    scenario.botMember = { status: "administrator", can_post_messages: false };
    const { telegramRequestId, correlationToken } = await newDirectRequest();
    await chatShared(USER_A, telegramRequestId);
    const data = await (await status(correlationToken)).json();
    expect(data).toMatchObject({ status: "failed", reason: "bot_missing_permissions", error: CHANNEL_FAILURE_MESSAGES.bot_missing_permissions });
    expect(await connectedRows()).toHaveLength(0);
    expect(botChatMessages()).toHaveLength(0);
  });

  it("the Onfile bot is not an administrator → failed", async () => {
    scenario.botMember = { status: "member" };
    const { telegramRequestId, correlationToken } = await newDirectRequest();
    await chatShared(USER_A, telegramRequestId);
    expect(await (await status(correlationToken)).json()).toMatchObject({ status: "failed", reason: "bot_not_admin" });
    expect(await connectedRows()).toHaveLength(0);
  });

  it("the selecting user is not an administrator of the channel → failed, nothing connected", async () => {
    scenario.userMember = { status: "member" };
    const { telegramRequestId, correlationToken } = await newDirectRequest();
    await chatShared(USER_A, telegramRequestId);
    expect(await (await status(correlationToken)).json()).toMatchObject({ status: "failed", reason: "user_not_admin" });
    expect(await connectedRows()).toHaveLength(0);
    expect(botChatMessages()).toHaveLength(0);
  });

  it("a PUBLIC channel (has a username) is rejected even if the picker let it through", async () => {
    scenario.chat = { id: CHAT_ID, type: "channel", title: "Public", username: "somepublicchannel" };
    const { telegramRequestId, correlationToken } = await newDirectRequest();
    await chatShared(USER_A, telegramRequestId);
    expect(await (await status(correlationToken)).json()).toMatchObject({ status: "failed", reason: "channel_is_public" });
    expect(await connectedRows()).toHaveLength(0);
  });

  it("a group / non-channel chat is rejected", async () => {
    scenario.chat = { id: CHAT_ID, type: "supergroup", title: "A group" };
    const { telegramRequestId, correlationToken } = await newDirectRequest();
    await chatShared(USER_A, telegramRequestId);
    expect(await (await status(correlationToken)).json()).toMatchObject({ status: "failed", reason: "not_a_channel" });
    expect(await connectedRows()).toHaveLength(0);
  });

  it("another Telegram user cannot complete this user's request: ignored, still pending, no Telegram calls", async () => {
    const { telegramRequestId, correlationToken } = await newDirectRequest(USER_A);
    await chatShared(USER_B, telegramRequestId);
    expect((await getRequestByToken(correlationToken))!.status).toBe("pending");
    expect((await getRequestByToken(correlationToken))!.selectedChatId).toBeNull();
    expect(await connectedRows()).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it("a forged / unknown request_id is ignored", async () => {
    await newDirectRequest();
    await chatShared(USER_A, 123_456_789);
    await chatShared(USER_A, 1);
    expect(await connectedRows()).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it("an expired request is ignored — nothing is verified or connected", async () => {
    const { telegramRequestId, correlationToken } = await newDirectRequest();
    await db
      .update(pendingChannelRequests)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(pendingChannelRequests.telegramRequestId, telegramRequestId));
    await chatShared(USER_A, telegramRequestId);
    expect(await connectedRows()).toHaveLength(0);
    expect(sent).toHaveLength(0);
    const res = await status(correlationToken);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ status: "expired" });
  });

  it("replay protection: a redelivered update, and a NEW update for the same request, neither re-verify nor duplicate", async () => {
    const { telegramRequestId, correlationToken } = await newDirectRequest();
    const update = chatSharedUpdate(USER_A, telegramRequestId);
    const fixedId = nextUpdateId++;
    updateIds.push(fixedId);
    const post = () =>
      WEBHOOK(new NextRequest("http://localhost/api/telegram/webhook", { method: "POST", body: JSON.stringify({ update_id: fixedId, ...update }), headers: { host: "localhost", "content-type": "application/json" } }));

    await post();
    expect((await getRequestByToken(correlationToken))!.status).toBe("verified");
    const callsAfterFirst = sent.length;

    await post(); // identical redelivery (same update_id)
    await chatShared(USER_A, telegramRequestId); // replay as a brand-new update
    await chatShared(USER_A, telegramRequestId, OTHER_CHAT_ID); // …and with a different channel

    expect(sent.length).toBe(callsAfterFirst);
    const rows = await connectedRows();
    expect(rows).toHaveLength(1);
    expect(await db.select().from(channels).where(eq(channels.telegramChannelId, String(OTHER_CHAT_ID)))).toHaveLength(0);
    expect((await getRequestByToken(correlationToken))!.selectedChatId).toBe(String(CHAT_ID));
  });

  it("concurrent duplicate deliveries verify and connect exactly once", async () => {
    const { telegramRequestId, correlationToken } = await newDirectRequest();
    await Promise.all([chatShared(USER_A, telegramRequestId), chatShared(USER_A, telegramRequestId), chatShared(USER_A, telegramRequestId)]);
    expect(await connectedRows()).toHaveLength(1);
    expect(sent.filter((c) => c.method === "getChat")).toHaveLength(1);
    expect((await getRequestByToken(correlationToken))!.status).toBe("verified");
  });

  it("a failed request cannot be revived by a later selection", async () => {
    scenario.userMember = { status: "member" };
    const { telegramRequestId, correlationToken } = await newDirectRequest();
    await chatShared(USER_A, telegramRequestId);
    expect((await getRequestByToken(correlationToken))!.status).toBe("failed");

    scenario.userMember = { status: "creator" };
    sent.length = 0;
    await chatShared(USER_A, telegramRequestId);
    expect((await getRequestByToken(correlationToken))!.status).toBe("failed");
    expect(await connectedRows()).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it("the status endpoint answers 'expired' (404) to another user presenting this request's token", async () => {
    const { telegramRequestId, correlationToken } = await newDirectRequest();
    await chatShared(USER_A, telegramRequestId);
    const res = await status(correlationToken, USER_B);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ status: "expired" });
  });

  it("a brand-new Telegram identity: full path creates ONE account + channel, and the status call hands over the session", async () => {
    const res = await connectRequest(NEW_USER);
    const { token } = await res.json();
    const pending = (await getPendingByToken(token))!;
    expect(pending.identity.sessionUserId).toBeNull();

    await chatShared(NEW_USER, pending.telegramRequestId);

    const statusRes = await status(token, NEW_USER);
    const data = await statusRes.json();
    expect(data.status).toBe("verified");
    expect(statusRes.headers.get("set-cookie") ?? "").toContain("=");
    const accounts = await db.select().from(users).where(eq(users.telegramId, String(NEW_USER)));
    expect(accounts).toHaveLength(1);
    const rows = await connectedRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(accounts[0].id);
    expect(botChatMessages()).toHaveLength(0);
  });
});

describe("POST /api/channels/connect-cancel with onlyIfUnselected (picker dismissed)", () => {
  it("cancels a request that never received a channel", async () => {
    const { correlationToken } = await newDirectRequest();
    const data = await (await cancel({ token: correlationToken, onlyIfUnselected: true })).json();
    expect(data.cancelled).toBe(true);
    expect((await getRequestByToken(correlationToken))!.failureReason).toBe("cancelled");
  });

  it("does NOT cancel a request that already carries a selection", async () => {
    const { telegramRequestId, correlationToken } = await newDirectRequest();
    await recordChannelSelection(USER_A, telegramRequestId, String(CHAT_ID));
    const data = await (await cancel({ token: correlationToken, onlyIfUnselected: true })).json();
    expect(data.cancelled).toBe(false);
    expect((await getRequestByToken(correlationToken))!.status).toBe("pending");
  });
});
