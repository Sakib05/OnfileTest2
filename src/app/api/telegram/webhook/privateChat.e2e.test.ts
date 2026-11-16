import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { botPrivateChats, channels, pendingChannelRequests, telegramUpdateLog, users } from "@/db/schema";
import { POST } from "./route";
import { POST as connectBotRequest } from "@/app/api/channels/connect-bot-request/route";
import { POST as connectBotStart } from "@/app/api/channels/connect-bot-start/route";
import { createBotStartPayload, BOT_MESSAGES } from "@/lib/botConnectFlow";
import { getPrivateChat, recordPrivateChat } from "@/lib/botPrivateChats";
import { beginBotConnect, createPendingChannelRequest, getPendingByToken } from "@/lib/pendingChannelRequests";
import { createSetupToken, SETUP_COOKIE_NAME } from "@/lib/setupToken";

/**
 * Webhook side of the returning-user flow: verified private chats are recorded
 * from trusted updates, blocking/unblocking is tracked, first-time /start with
 * the signed payload still works (and makes the user a "returning" user), and
 * confirmations are sent to the stored chat id. Only the Telegram Bot API is
 * mocked; real Postgres. Requires a disposable DEV database.
 */

const USER = 900_600_001;
const USER_B = 900_600_002;
const PRIVATE_CHAT = 700_600_001; // != USER on purpose
const CHANNEL = -1_009_600_000_001;
const BOT_ID = 999_601;
const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_ENV = { token: process.env.TELEGRAM_BOT_TOKEN, secret: process.env.TELEGRAM_WEBHOOK_SECRET };

let calls: { method: string; body: Record<string, unknown> }[] = [];
let updateIds: number[] = [];
let nextUpdateId = 8_600_000_000;
let accountId: number;
let ip = 0;

function installMock() {
  calls = [];
  global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const method = String(url).split("/").pop() as string;
    const body = init?.body ? JSON.parse(init.body as string) : {};
    calls.push({ method, body });
    let result: unknown = true;
    if (method === "getMe") result = { id: BOT_ID, username: "TestOnfileBot" };
    else if (method === "getChat") result = { id: CHANNEL, type: "channel", title: "Priv Channel" };
    else if (method === "getChatMember") result = body.user_id === BOT_ID ? { status: "administrator", can_post_messages: true } : { status: "creator" };
    return new Response(JSON.stringify({ ok: true, result }), { status: 200 });
  }) as unknown as typeof fetch;
}
const sentMessages = () => calls.filter((c) => c.method === "sendMessage");

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

const privateMemberUpdate = (status: string, from = USER, chatId = PRIVATE_CHAT, botId = BOT_ID) => ({
  my_chat_member: {
    chat: { id: chatId, type: "private" },
    from: { id: from },
    date: 1,
    old_chat_member: { status: "member", user: { id: botId } },
    new_chat_member: { status, user: { id: botId } },
  },
});

async function cleanup() {
  const ids = [String(USER), String(USER_B)];
  await db.delete(channels).where(eq(channels.telegramChannelId, String(CHANNEL)));
  await db.delete(pendingChannelRequests).where(inArray(pendingChannelRequests.telegramUserId, ids));
  await db.delete(botPrivateChats).where(inArray(botPrivateChats.telegramUserId, ids));
  if (updateIds.length) await db.delete(telegramUpdateLog).where(inArray(telegramUpdateLog.updateId, updateIds));
  updateIds = [];
}

beforeEach(async () => {
  process.env.TELEGRAM_BOT_TOKEN = "test-token-private-chat-e2e";
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
  installMock();
  await cleanup();
  const [u] = await db
    .insert(users)
    .values({ telegramId: String(USER), referralCode: "E2EPRV01" })
    .onConflictDoUpdate({ target: users.telegramId, set: { updatedAt: new Date() } })
    .returning();
  accountId = u.id;
});
afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  vi.restoreAllMocks();
});
afterAll(async () => {
  process.env.TELEGRAM_BOT_TOKEN = ORIGINAL_ENV.token;
  if (ORIGINAL_ENV.secret) process.env.TELEGRAM_WEBHOOK_SECRET = ORIGINAL_ENV.secret;
  await cleanup();
  await db.delete(users).where(eq(users.telegramId, String(USER)));
});

describe("recording the verified private chat from webhook updates", () => {
  it("a user's message in a private chat records (user id → chat id) without sending anything", async () => {
    await webhook({ message: { chat: { id: PRIVATE_CHAT, type: "private" }, from: { id: USER }, text: "hello" } });
    expect(await getPrivateChat(USER)).toMatchObject({ chatId: String(PRIVATE_CHAT), status: "active", source: "webhook" });
    expect(sentMessages()).toHaveLength(0);
  });

  it("group/channel messages and bot-authored messages are never recorded", async () => {
    await webhook({ message: { chat: { id: -100777, type: "supergroup" }, from: { id: USER }, text: "hi" } });
    await webhook({ message: { chat: { id: PRIVATE_CHAT, type: "private" }, from: { id: USER, is_bot: true }, text: "hi" } });
    expect(await getPrivateChat(USER)).toBeNull();
  });

  it("blocking the bot (my_chat_member → kicked) marks the chat blocked; restarting reactivates it", async () => {
    await recordPrivateChat(USER, PRIVATE_CHAT);
    await webhook(privateMemberUpdate("kicked"));
    expect((await getPrivateChat(USER))?.status).toBe("blocked");
    await webhook(privateMemberUpdate("member"));
    expect((await getPrivateChat(USER))?.status).toBe("active");
  });

  it("a my_chat_member about some OTHER bot is ignored", async () => {
    await recordPrivateChat(USER, PRIVATE_CHAT);
    await webhook(privateMemberUpdate("kicked", USER, PRIVATE_CHAT, BOT_ID + 1));
    expect((await getPrivateChat(USER))?.status).toBe("active");
  });
});

describe("first-time user: signed Start flow", () => {
  it("/start <signed payload> sends the 'Select channel to connect' keyboard to the private chat and records it", async () => {
    const created = await createPendingChannelRequest({ telegramUserId: USER, sessionUserId: accountId, telegramProfile: null }, { method: "bot" });
    await beginBotConnect((await getPendingByToken(created.correlationToken))!.id); // "Connect" was tapped
    await webhook({
      message: {
        chat: { id: PRIVATE_CHAT, type: "private" },
        from: { id: USER },
        text: `/start ${createBotStartPayload(created.telegramRequestId, USER)}`,
      },
    });
    // First contact: creator welcome first, then the (unchanged) native channel picker.
    expect(sentMessages()).toHaveLength(2);
    expect(sentMessages()[0].body.text).toBe(BOT_MESSAGES.welcome);
    expect(sentMessages()[0].body.reply_markup).toBeUndefined();
    const msg = sentMessages()[1];
    expect(String(msg.body.chat_id)).toBe(String(PRIVATE_CHAT));
    const markup = msg.body.reply_markup as { keyboard: { text: string; request_chat: { request_id: number } }[][] };
    expect(markup.keyboard[0][0].text).toBe("Select channel to connect");
    expect(markup.keyboard[0][0].request_chat.request_id).toBe(created.telegramRequestId);
    expect(await getPrivateChat(USER)).toMatchObject({ chatId: String(PRIVATE_CHAT) });
  });

  it("a forged / other-user payload is rejected with the neutral invalid-link reply", async () => {
    const created = await createPendingChannelRequest({ telegramUserId: USER, sessionUserId: accountId, telegramProfile: null }, { method: "bot" });
    await beginBotConnect((await getPendingByToken(created.correlationToken))!.id); // "Connect" was tapped
    await webhook({
      message: {
        chat: { id: 700_600_002, type: "private" },
        from: { id: USER_B },
        text: `/start ${createBotStartPayload(created.telegramRequestId, USER)}`,
      },
    });
    // Brand-new Telegram user: welcome, then the neutral invalid-link reply — never a picker.
    expect(String(sentMessages().at(-1)!.body.text)).toBe(BOT_MESSAGES.invalidLink);
    expect(JSON.stringify(sentMessages().map((m) => m.body.reply_markup ?? {}))).not.toContain("request_chat");
  });

  it("after that first Start the user is a RETURNING user: the next connect uses the existing chat, no start link", async () => {
    await webhook({ message: { chat: { id: PRIVATE_CHAT, type: "private" }, from: { id: USER }, text: "/start" } });
    calls = [];
    const cookie = `${SETUP_COOKIE_NAME}=${createSetupToken({ id: USER, first_name: "T" })}`;
    const started = await (
      await connectBotRequest(
        new NextRequest("http://localhost/api/channels/connect-bot-request", {
          method: "POST",
          headers: { host: "localhost", "x-forwarded-for": `10.60.0.${++ip}`, cookie },
        })
      )
    ).json();
    const res = await connectBotStart(
      new NextRequest("http://localhost/api/channels/connect-bot-start", {
        method: "POST",
        headers: { host: "localhost", "content-type": "application/json", "x-forwarded-for": `10.60.0.${++ip}`, cookie },
        body: JSON.stringify({ token: started.token }),
      })
    );
    const data = await res.json();
    expect(data.mode).toBe("existing_chat");
    expect(data.botUrl).not.toContain("start=");
    expect(String(sentMessages()[0].body.chat_id)).toBe(String(PRIVATE_CHAT));
  });
});

describe("confirmations use the stored chat id", () => {
  it("the verification message after chat_shared goes to the private chat the update arrived in (not the user id) and nothing is connected yet", async () => {
    await recordPrivateChat(USER, PRIVATE_CHAT);
    const created = await createPendingChannelRequest({ telegramUserId: USER, sessionUserId: accountId, telegramProfile: null }, { method: "bot" });
    await beginBotConnect((await getPendingByToken(created.correlationToken))!.id); // "Connect" was tapped
    await webhook({
      message: {
        chat: { id: PRIVATE_CHAT, type: "private" },
        from: { id: USER },
        chat_shared: { request_id: created.telegramRequestId, chat_id: CHANNEL },
      },
    });
    const after = (await getPendingByToken(created.correlationToken))!;
    expect(after.status).toBe("pending"); // selected, NOT connected: the Mini App's Verify does that
    expect(after.selectedChatId).toBe(String(CHANNEL));
    const note = sentMessages().at(-1)!;
    expect(String(note.body.text)).toBe("🔐 Channel Verification\n\n🚀 Tap the button below to verify your connection.");
    expect(String(note.body.chat_id)).toBe(String(PRIVATE_CHAT));
    expect(String(note.body.chat_id)).not.toBe(String(USER));
  });

  it("a first plain /start gets the creator welcome; a later plain /start does not repeat the onboarding", async () => {
    await webhook({ message: { chat: { id: PRIVATE_CHAT, type: "private" }, from: { id: USER }, text: "/start" } });
    expect(sentMessages()).toHaveLength(1);
    expect(String(sentMessages()[0].body.text)).toBe(BOT_MESSAGES.welcome);

    await webhook({ message: { chat: { id: PRIVATE_CHAT, type: "private" }, from: { id: USER }, text: "/start" } });
    expect(sentMessages()).toHaveLength(2);
    expect(String(sentMessages()[1].body.text)).toBe(BOT_MESSAGES.welcomeBack);
  });

  it("a user already on file (returning) never gets the creator welcome before the signed-Start picker", async () => {
    await recordPrivateChat(USER, PRIVATE_CHAT);
    const created = await createPendingChannelRequest({ telegramUserId: USER, sessionUserId: accountId, telegramProfile: null }, { method: "bot" });
    await beginBotConnect((await getPendingByToken(created.correlationToken))!.id);
    await webhook({
      message: { chat: { id: PRIVATE_CHAT, type: "private" }, from: { id: USER }, text: `/start ${createBotStartPayload(created.telegramRequestId, USER)}` },
    });
    expect(sentMessages()).toHaveLength(1);
    expect(JSON.stringify(sentMessages()[0].body.reply_markup)).toContain("request_chat");
  });

  it("the Verify web_app button is attached to the verification message and no second pending request is created", async () => {
    process.env.MINI_APP_URL = "https://onfile.example.test";
    try {
      await recordPrivateChat(USER, PRIVATE_CHAT);
      const created = await createPendingChannelRequest({ telegramUserId: USER, sessionUserId: accountId, telegramProfile: null }, { method: "bot" });
      await beginBotConnect((await getPendingByToken(created.correlationToken))!.id);
      const before = await db.select().from(pendingChannelRequests).where(eq(pendingChannelRequests.telegramUserId, String(USER)));
      await webhook({
        message: { chat: { id: PRIVATE_CHAT, type: "private" }, from: { id: USER }, chat_shared: { request_id: created.telegramRequestId, chat_id: CHANNEL } },
      });
      const note = sentMessages().at(-1)!;
      expect(String(note.body.text)).toBe("🔐 Channel Verification\n\n🚀 Tap the button below to verify your connection.");
      expect(note.body.reply_markup).toEqual({
        inline_keyboard: [[{ text: "Verify", web_app: { url: `https://onfile.example.test/?connect=${created.telegramRequestId}` } }]],
      });
      const after = await db.select().from(pendingChannelRequests).where(eq(pendingChannelRequests.telegramUserId, String(USER)));
      expect(after).toHaveLength(before.length);
    } finally {
      delete process.env.MINI_APP_URL;
    }
  });

  it("the message never contains a title taken from the update, and nothing is verified before it is sent", async () => {
    await recordPrivateChat(USER, PRIVATE_CHAT);
    const created = await createPendingChannelRequest({ telegramUserId: USER, sessionUserId: accountId, telegramProfile: null }, { method: "bot" });
    await beginBotConnect((await getPendingByToken(created.correlationToken))!.id);
    await webhook({
      message: {
        chat: { id: PRIVATE_CHAT, type: "private" }, from: { id: USER },
        chat_shared: { request_id: created.telegramRequestId, chat_id: CHANNEL, title: "Spoofed Title" },
      },
    });
    const texts = sentMessages().map((m) => String(m.body.text));
    expect(texts.some((t) => t.includes("Spoofed Title"))).toBe(false);
    expect(calls.filter((c) => ["getChat", "getChatMember"].includes(c.method))).toHaveLength(0);
    expect((await getPendingByToken(created.correlationToken))?.status).toBe("pending");
  });
});
