import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { botPrivateChats, channels, pendingChannelRequests, telegramUpdateLog, users } from "@/db/schema";
import { POST } from "./route";
import { POST as connectBotRequest } from "@/app/api/channels/connect-bot-request/route";
import { createBotStartPayload, BOT_MESSAGES } from "@/lib/botConnectFlow";
import { getPrivateChat, recordPrivateChat } from "@/lib/botPrivateChats";
import { createPendingChannelRequest, getPendingByToken } from "@/lib/pendingChannelRequests";
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
    await webhook({
      message: {
        chat: { id: PRIVATE_CHAT, type: "private" },
        from: { id: USER },
        text: `/start ${createBotStartPayload(created.telegramRequestId, USER)}`,
      },
    });
    const msg = sentMessages()[0];
    expect(String(msg.body.chat_id)).toBe(String(PRIVATE_CHAT));
    const markup = msg.body.reply_markup as { keyboard: { text: string; request_chat: { request_id: number } }[][] };
    expect(markup.keyboard[0][0].text).toBe("Select channel to connect");
    expect(markup.keyboard[0][0].request_chat.request_id).toBe(created.telegramRequestId);
    expect(await getPrivateChat(USER)).toMatchObject({ chatId: String(PRIVATE_CHAT) });
  });

  it("a forged / other-user payload is rejected with the neutral invalid-link reply", async () => {
    const created = await createPendingChannelRequest({ telegramUserId: USER, sessionUserId: accountId, telegramProfile: null }, { method: "bot" });
    await webhook({
      message: {
        chat: { id: 700_600_002, type: "private" },
        from: { id: USER_B },
        text: `/start ${createBotStartPayload(created.telegramRequestId, USER)}`,
      },
    });
    expect(String(sentMessages()[0].body.text)).toBe(BOT_MESSAGES.invalidLink);
    expect(JSON.stringify(sentMessages()[0].body.reply_markup ?? {})).not.toContain("request_chat");
  });

  it("after that first Start the user is a RETURNING user: the next connect uses the existing chat, no start link", async () => {
    await webhook({ message: { chat: { id: PRIVATE_CHAT, type: "private" }, from: { id: USER }, text: "/start" } });
    calls = [];
    const res = await connectBotRequest(
      new NextRequest("http://localhost/api/channels/connect-bot-request", {
        method: "POST",
        headers: {
          host: "localhost",
          "x-forwarded-for": `10.60.0.${++ip}`,
          cookie: `${SETUP_COOKIE_NAME}=${createSetupToken({ id: USER, first_name: "T" })}`,
        },
      })
    );
    const data = await res.json();
    expect(data.mode).toBe("existing_chat");
    expect(data.botUrl).not.toContain("start=");
    expect(String(sentMessages()[0].body.chat_id)).toBe(String(PRIVATE_CHAT));
  });
});

describe("confirmations use the stored chat id", () => {
  it("the success message after chat_shared goes to the stored private chat (not the user id) and the connection completes", async () => {
    await recordPrivateChat(USER, PRIVATE_CHAT);
    const created = await createPendingChannelRequest({ telegramUserId: USER, sessionUserId: accountId, telegramProfile: null }, { method: "bot" });
    await webhook({
      message: {
        chat: { id: PRIVATE_CHAT, type: "private" },
        from: { id: USER },
        chat_shared: { request_id: created.telegramRequestId, chat_id: CHANNEL },
      },
    });
    expect((await getPendingByToken(created.correlationToken))?.status).toBe("verified");
    const note = sentMessages().at(-1)!;
    expect(String(note.body.text)).toContain("is now connected to your Onfile account");
    expect(String(note.body.chat_id)).toBe(String(PRIVATE_CHAT));
    expect(String(note.body.chat_id)).not.toBe(String(USER));
  });

  it("a plain /start (no payload) still gets the neutral welcome — pre-existing behaviour preserved", async () => {
    await webhook({ message: { chat: { id: PRIVATE_CHAT, type: "private" }, from: { id: USER }, text: "/start" } });
    expect(String(sentMessages()[0].body.text)).toBe(BOT_MESSAGES.welcome);
  });
});
