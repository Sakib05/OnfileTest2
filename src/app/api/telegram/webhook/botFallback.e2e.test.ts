import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { channels, pendingChannelRequests, telegramUpdateLog, users } from "@/db/schema";
import { POST } from "./route";
import { createBotStartPayload } from "@/lib/botConnectFlow";
import { CHANNEL_FAILURE_MESSAGES } from "@/lib/channelConnection";
import { beginBotConnect, createPendingChannelRequest, getPendingByToken } from "@/lib/pendingChannelRequests";

/**
 * End-to-end tests of the "Connect channel via bot" fallback through the real
 * webhook route + real Postgres, with ONLY the Telegram Bot API mocked
 * (fetch). Requires a disposable DEV database with the schema applied.
 */

const USER_A = 900_200_001;
const USER_B = 900_200_002;
const CHAT_ID = -1_009_200_000_001;
const BOT_ID = 999_001;
const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_ENV = { token: process.env.TELEGRAM_BOT_TOKEN, secret: process.env.TELEGRAM_WEBHOOK_SECRET };

interface Scenario {
  chat: { id: number; type: string; title?: string; username?: string };
  botMember: { status: string; can_post_messages?: boolean };
  userMember: { status: string };
}
let scenario: Scenario;
let sent: { method: string; body: Record<string, unknown> }[] = [];
let updateIds: number[] = [];
let nextUpdateId = 8_200_000_000;
let accountA: number;

const privateChannel = (): Scenario => ({
  chat: { id: CHAT_ID, type: "channel", title: "My Private Channel" },
  botMember: { status: "administrator", can_post_messages: true },
  userMember: { status: "creator" },
});

function installTelegramMock() {
  sent = [];
  global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const method = String(url).split("/").pop() as string;
    const body = init?.body ? JSON.parse(init.body as string) : {};
    sent.push({ method, body });
    let result: unknown = true;
    if (method === "getMe") result = { id: BOT_ID, username: "TestOnfileBot" };
    else if (method === "getChat") result = scenario.chat;
    else if (method === "getChatMember") result = body.user_id === BOT_ID ? scenario.botMember : scenario.userMember;
    return new Response(JSON.stringify({ ok: true, result }), { status: 200 });
  }) as unknown as typeof fetch;
}

function webhook(update: Record<string, unknown>) {
  const update_id = nextUpdateId++;
  updateIds.push(update_id);
  return POST(
    new NextRequest("http://localhost/api/telegram/webhook", {
      method: "POST",
      body: JSON.stringify({ update_id, ...update }),
      headers: { host: "localhost", "content-type": "application/json" },
    })
  );
}

const chatShared = (fromId: number, requestId: number, chatId = CHAT_ID) =>
  webhook({
    message: { chat: { id: fromId, type: "private" }, from: { id: fromId }, chat_shared: { request_id: requestId, chat_id: chatId } },
  });

async function getRequestRowByToken(token: string) {
  const pending = (await getPendingByToken(token))!;
  return { telegramRequestId: pending.telegramRequestId };
}

const userMessages = () => sent.filter((c) => c.method === "sendMessage");
const connectedRows = () => db.select().from(channels).where(eq(channels.telegramChannelId, String(CHAT_ID)));

/** A request that is already "connecting" (Start + Connect done) — the state in which the bot may act. */
async function newBotRequest(method: "bot" | "direct" = "bot", opts: { connect?: boolean } = {}) {
  const created = await createPendingChannelRequest(
    { telegramUserId: USER_A, sessionUserId: accountA, telegramProfile: null },
    { method }
  );
  let pending = (await getPendingByToken(created.correlationToken))!;
  if (method === "bot" && opts.connect !== false) {
    await beginBotConnect(pending.id);
    pending = (await getPendingByToken(created.correlationToken))!;
  }
  return { ...created, pending };
}

async function cleanup() {
  await db.delete(channels).where(eq(channels.telegramChannelId, String(CHAT_ID)));
  await db.delete(pendingChannelRequests).where(inArray(pendingChannelRequests.telegramUserId, [String(USER_A), String(USER_B)]));
  if (updateIds.length) await db.delete(telegramUpdateLog).where(inArray(telegramUpdateLog.updateId, updateIds));
  updateIds = [];
}

beforeEach(async () => {
  process.env.TELEGRAM_BOT_TOKEN = "test-token-bot-fallback-e2e";
  process.env.MINI_APP_URL = "https://onfile.example.test";
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
  scenario = privateChannel();
  installTelegramMock();
  await cleanup();
  const [u] = await db
    .insert(users)
    .values({ telegramId: String(USER_A), referralCode: "E2EBOT01" })
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
  await db.delete(users).where(eq(users.telegramId, String(USER_A)));
});

describe("bot fallback — /start through the webhook", () => {
  it("replies to a valid /start with the request_chat keyboard for the pending request", async () => {
    const { telegramRequestId } = await newBotRequest();
    const res = await webhook({
      message: {
        chat: { id: USER_A, type: "private" },
        from: { id: USER_A },
        text: `/start ${createBotStartPayload(telegramRequestId, USER_A)}`,
      },
    });
    expect(res.status).toBe(200);
    const msg = userMessages()[0];
    const markup = msg.body.reply_markup as { keyboard: { request_chat: { request_id: number; chat_has_username: boolean; chat_is_channel: boolean } }[][] };
    expect(markup.keyboard[0][0].request_chat.request_id).toBe(telegramRequestId);
    expect(markup.keyboard[0][0].request_chat.chat_is_channel).toBe(true);
    expect(markup.keyboard[0][0].request_chat.chat_has_username).toBe(false);
  });
});

describe("bot fallback — chat_shared verification", () => {
  it("accepts an eligible private channel and connects it to the correct Onfile account", async () => {
    const { telegramRequestId, correlationToken } = await newBotRequest();
    await chatShared(USER_A, telegramRequestId);

    const rows = await connectedRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(accountA);
    expect(rows[0].status).toBe("verified");
    expect(rows[0].botIsAdmin).toBe(true);

    const after = await getPendingByToken(correlationToken);
    expect(after?.status).toBe("verified");
    expect(after?.resolvedUserId).toBe(accountA);

    // Live re-verification actually happened against the Bot API.
    expect(sent.some((c) => c.method === "getChat")).toBe(true);
    expect(sent.filter((c) => c.method === "getChatMember").length).toBe(2);

    const note = userMessages().at(-1)!;
    expect(String(note.body.text)).toBe(
      "🔐 Channel Verification\n\nYour channel connection is ready.\n\nTap the button below to verify your connection and continue to your Onfile dashboard."
    );
    // "Verify" re-opens the Mini App via a web_app button; the URL carries only the public request ref.
    const { telegramRequestId: ref } = await getRequestRowByToken(correlationToken);
    expect(note.body.reply_markup).toEqual({
      inline_keyboard: [[{ text: "Verify", web_app: { url: `https://onfile.example.test/?connect=${ref}` } }]],
    });
    // Confirmation goes to the verified private chat id (stored as a string), not a user-id assumption.
    expect(String(note.body.chat_id)).toBe(String(USER_A));
  });

  it("rejects a public channel (private-only rule preserved)", async () => {
    scenario.chat.username = "some_public_channel";
    const { telegramRequestId, correlationToken } = await newBotRequest();
    await chatShared(USER_A, telegramRequestId);

    expect(await connectedRows()).toHaveLength(0);
    const after = await getPendingByToken(correlationToken);
    expect(after?.status).toBe("failed");
    expect(after?.failureReason).toBe("channel_is_public");
    expect(String(userMessages().at(-1)!.body.text)).toContain(CHANNEL_FAILURE_MESSAGES.channel_is_public);
  });

  it("rejects a non-channel chat (e.g. a group)", async () => {
    scenario.chat = { id: CHAT_ID, type: "supergroup", title: "A group" };
    const { telegramRequestId, correlationToken } = await newBotRequest();
    await chatShared(USER_A, telegramRequestId);
    expect(await connectedRows()).toHaveLength(0);
    expect((await getPendingByToken(correlationToken))?.failureReason).toBe("not_a_channel");
  });

  it("handles the bot not being an administrator", async () => {
    scenario.botMember = { status: "member" };
    const { telegramRequestId, correlationToken } = await newBotRequest();
    await chatShared(USER_A, telegramRequestId);
    expect(await connectedRows()).toHaveLength(0);
    expect((await getPendingByToken(correlationToken))?.failureReason).toBe("bot_not_admin");
    expect(String(userMessages().at(-1)!.body.text)).toContain(CHANNEL_FAILURE_MESSAGES.bot_not_admin);
  });

  it("handles missing bot permissions (cannot post messages)", async () => {
    scenario.botMember = { status: "administrator", can_post_messages: false };
    const { telegramRequestId, correlationToken } = await newBotRequest();
    await chatShared(USER_A, telegramRequestId);
    expect(await connectedRows()).toHaveLength(0);
    expect((await getPendingByToken(correlationToken))?.failureReason).toBe("bot_missing_permissions");
    expect(String(userMessages().at(-1)!.body.text)).toContain(CHANNEL_FAILURE_MESSAGES.bot_missing_permissions);
  });

  it("rejects a user who is not an administrator of the selected channel", async () => {
    scenario.userMember = { status: "member" };
    const { telegramRequestId, correlationToken } = await newBotRequest();
    await chatShared(USER_A, telegramRequestId);
    expect(await connectedRows()).toHaveLength(0);
    expect((await getPendingByToken(correlationToken))?.failureReason).toBe("user_not_admin");
  });

  it("rejects the wrong Telegram user — the request stays pending and nothing is connected or sent", async () => {
    const { telegramRequestId, correlationToken } = await newBotRequest();
    await chatShared(USER_B, telegramRequestId);

    expect(await connectedRows()).toHaveLength(0);
    expect((await getPendingByToken(correlationToken))?.status).toBe("pending");
    expect(userMessages()).toHaveLength(0);
    expect(sent.some((c) => c.method === "getChat")).toBe(false);
  });

  it("rejects an expired request and tells the user", async () => {
    const { telegramRequestId, pending } = await newBotRequest();
    await db.update(pendingChannelRequests).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(pendingChannelRequests.id, pending.id));

    await chatShared(USER_A, telegramRequestId);

    expect(await connectedRows()).toHaveLength(0);
    expect(String(userMessages().at(-1)!.body.text)).toContain("expired");
    expect(sent.some((c) => c.method === "getChat")).toBe(false);
  });

  it("rejects a replayed selection: one connection, one confirmation", async () => {
    const { telegramRequestId } = await newBotRequest();
    await chatShared(USER_A, telegramRequestId);
    const messagesAfterFirst = userMessages().length;
    const getChatCallsAfterFirst = sent.filter((c) => c.method === "getChat").length;

    await chatShared(USER_A, telegramRequestId); // new update_id, same request

    expect(await connectedRows()).toHaveLength(1);
    expect(userMessages()).toHaveLength(messagesAfterFirst);
    expect(sent.filter((c) => c.method === "getChat")).toHaveLength(getChatCallsAfterFirst);
  });

  it("a redelivered identical Telegram update is skipped entirely (update_id idempotency)", async () => {
    const { telegramRequestId } = await newBotRequest();
    const update = {
      update_id: nextUpdateId++,
      message: { chat: { id: USER_A, type: "private" }, from: { id: USER_A }, chat_shared: { request_id: telegramRequestId, chat_id: CHAT_ID } },
    };
    updateIds.push(update.update_id);
    const mk = () =>
      POST(new NextRequest("http://localhost/api/telegram/webhook", { method: "POST", body: JSON.stringify(update), headers: { host: "localhost" } }));
    await mk();
    const n = sent.length;
    await mk();
    expect(sent.length).toBe(n);
    expect(await connectedRows()).toHaveLength(1);
  });

  it("two simultaneous pending bot requests are resolved independently by their own request ids", async () => {
    const first = await newBotRequest();
    const second = await newBotRequest();
    await chatShared(USER_A, second.telegramRequestId);

    expect((await getPendingByToken(second.correlationToken))?.status).toBe("verified");
    expect((await getPendingByToken(first.correlationToken))?.status).toBe("pending");
    expect(await connectedRows()).toHaveLength(1);
  });
});

describe("regression — Direct Picker requests are unaffected by the bot fallback", () => {
  it("a direct request still connects the channel, and sends NO bot-chat messages", async () => {
    const { telegramRequestId, correlationToken } = await newBotRequest("direct");
    await chatShared(USER_A, telegramRequestId);

    expect((await getPendingByToken(correlationToken))?.status).toBe("verified");
    expect(await connectedRows()).toHaveLength(1);
    expect(userMessages()).toHaveLength(0);
  });

  it("a failed direct request sends no bot-chat messages either", async () => {
    scenario.chat.username = "public_one";
    const { telegramRequestId, correlationToken } = await newBotRequest("direct");
    await chatShared(USER_A, telegramRequestId);
    expect((await getPendingByToken(correlationToken))?.failureReason).toBe("channel_is_public");
    expect(userMessages()).toHaveLength(0);
  });
});

describe("bot-guided flow — lifecycle, messages and idempotency", () => {
  const start = (requestId: number, fromId = USER_A) =>
    webhook({
      message: { chat: { id: fromId, type: "private" }, from: { id: fromId }, text: `/start ${createBotStartPayload(requestId, fromId)}` },
    });

  it("first-time activation: /start <signed payload> sends the welcome text + native picker bound to THIS request, once Connect was tapped", async () => {
    const { telegramRequestId, correlationToken } = await newBotRequest();
    await start(telegramRequestId);
    const msg = userMessages()[0].body;
    expect(String(msg.text)).toContain("Welcome to Onfile Channel Connection!");
    expect(String(msg.text)).toContain("Make sure the Onfile bot has the required administrator permissions in your channel.");
    expect(String(msg.text)).toContain("expire in 10 minutes");
    const markup = msg.reply_markup as { keyboard: { text: string; request_chat: { request_id: number } }[][] };
    expect(markup.keyboard[0][0].request_chat.request_id).toBe(telegramRequestId);
    expect((await getPendingByToken(correlationToken))?.lifecycle).toBe("awaiting_channel_selection");
  });

  it("a request that was only prepared (Start, no Connect) gets NO picker from /start — the user is told to tap Connect", async () => {
    const { telegramRequestId } = await newBotRequest("bot", { connect: false });
    await start(telegramRequestId);
    expect(userMessages()).toHaveLength(1);
    expect(String(userMessages()[0].body.text)).toContain("tap “Connect”");
    expect(JSON.stringify(userMessages()[0].body.reply_markup ?? {})).not.toContain("request_chat");
  });

  it("a chat_shared for a merely-prepared request is ignored (nothing connected, nothing sent)", async () => {
    const { telegramRequestId, correlationToken } = await newBotRequest("bot", { connect: false });
    await chatShared(USER_A, telegramRequestId);
    expect(await connectedRows()).toHaveLength(0);
    expect((await getPendingByToken(correlationToken))?.status).toBe("pending");
    expect(userMessages()).toHaveLength(0);
  });

  it("an expired request is refused at /start too", async () => {
    const { telegramRequestId, pending } = await newBotRequest();
    await db.update(pendingChannelRequests).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(pendingChannelRequests.id, pending.id));
    await start(telegramRequestId);
    expect(String(userMessages()[0].body.text)).toContain("expired");
    expect(JSON.stringify(userMessages()[0].body.reply_markup ?? {})).not.toContain("request_chat");
  });

  it("the verification message is sent exactly once even when Telegram redelivers the selection under a new update_id", async () => {
    const { telegramRequestId } = await newBotRequest();
    await chatShared(USER_A, telegramRequestId);
    await chatShared(USER_A, telegramRequestId);
    await chatShared(USER_A, telegramRequestId);
    expect(userMessages().filter((m) => String(m.body.text).includes("Channel Verification"))).toHaveLength(1);
  });

  it("the Verify button URL holds only the public ref — no token, secret, user id or channel id", async () => {
    const { telegramRequestId, correlationToken } = await newBotRequest();
    await chatShared(USER_A, telegramRequestId);
    const markup = JSON.stringify(userMessages().at(-1)!.body.reply_markup);
    expect(markup).toContain(`?connect=${telegramRequestId}`);
    expect(markup).not.toContain(correlationToken);
    expect(markup).not.toContain(String(USER_A));
    expect(markup).not.toContain(String(CHAT_ID));
    expect(markup).not.toContain("test-token-bot-fallback-e2e");
  });

  it("without an https Mini App URL the confirmation is still sent (no broken button)", async () => {
    delete process.env.MINI_APP_URL;
    for (const k of ["NEXT_PUBLIC_APP_URL", "VERCEL_PROJECT_PRODUCTION_URL", "VERCEL_URL", "VERCEL_ENV"]) delete process.env[k];
    const { telegramRequestId } = await newBotRequest();
    await chatShared(USER_A, telegramRequestId);
    const note = userMessages().at(-1)!.body;
    expect(String(note.text)).toContain("Channel Verification");
    expect(note.reply_markup).toEqual({ remove_keyboard: true });
  });

  it("a channel already connected to another account is refused with the right explanation", async () => {
    const [other] = await db.insert(users).values({ telegramId: String(USER_B), referralCode: "E2EBOT02" }).onConflictDoUpdate({ target: users.telegramId, set: { updatedAt: new Date() } }).returning();
    await db.insert(channels).values({ userId: other.id, telegramChannelId: String(CHAT_ID), channelName: "Taken", status: "verified", isVerified: true, botIsAdmin: true });
    const { telegramRequestId, correlationToken } = await newBotRequest();
    await chatShared(USER_A, telegramRequestId);
    const after = await getPendingByToken(correlationToken);
    expect(after?.status).toBe("failed");
    expect(after?.failureReason).toBe("channel_already_connected");
    expect(String(userMessages().at(-1)!.body.text)).toContain(CHANNEL_FAILURE_MESSAGES.channel_already_connected);
    expect((await connectedRows()).every((r) => r.userId === other.id)).toBe(true);
    await db.delete(channels).where(eq(channels.telegramChannelId, String(CHAT_ID)));
    await db.delete(users).where(eq(users.id, other.id));
  });

  it("an unsupported selection (user picks a group) is refused and explained; nothing is connected", async () => {
    scenario.chat = { id: CHAT_ID, type: "group", title: "A group" };
    const { telegramRequestId } = await newBotRequest();
    await chatShared(USER_A, telegramRequestId);
    expect(await connectedRows()).toHaveLength(0);
    expect(String(userMessages().at(-1)!.body.text)).toContain(CHANNEL_FAILURE_MESSAGES.not_a_channel);
  });
});
