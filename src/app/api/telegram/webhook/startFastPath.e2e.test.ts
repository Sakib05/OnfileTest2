import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { db, pool } from "@/db";
import { botPrivateChats, pendingChannelRequests, telegramUpdateLog, users } from "@/db/schema";
import { POST } from "./route";
import { BOT_MESSAGES, createBotStartPayload } from "@/lib/botConnectFlow";
import { getPrivateChat, recordPrivateChat } from "@/lib/botPrivateChats";
import { beginBotConnect, createPendingChannelRequest, getPendingByToken } from "@/lib/pendingChannelRequests";

/**
 * Ordinary `/start` fast path: the approved Welcome Message goes out with NO account lookup, NO
 * `bot_private_chats` read/write and NO extra Telegram API call — and every special flow (signed
 * `/start c1_…`, `/connect`, other messages) keeps its bookkeeping. Only the Telegram Bot API is mocked;
 * real Postgres (requires a disposable DEV database). SQL statements are captured at the pg pool.
 */

const NEW_USER = 900_700_001; // never seen before: no users row, no bot_private_chats row
const OLD_USER = 900_700_002; // returning: has a users row AND a bot_private_chats row
const SIGNED_USER = 900_700_003;
const NEW_CHAT = 700_700_001;
const OLD_CHAT = 700_700_002;
const SIGNED_CHAT = 700_700_003;
const ALL_USERS = [NEW_USER, OLD_USER, SIGNED_USER].map(String);
const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_ENV = { token: process.env.TELEGRAM_BOT_TOKEN, secret: process.env.TELEGRAM_WEBHOOK_SECRET };

let calls: { method: string; body: Record<string, unknown> }[] = [];
let updateIds: number[] = [];
let nextUpdateId = 8_700_000_000;
let sqlLog: string[] = [];

function installFetchMock(opts: { failSend?: boolean } = {}) {
  calls = [];
  global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const method = String(url).split("/").pop() as string;
    const body = init?.body ? JSON.parse(init.body as string) : {};
    calls.push({ method, body });
    if (method === "sendMessage" && opts.failSend) {
      return new Response(JSON.stringify({ ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" }), { status: 403 });
    }
    return new Response(JSON.stringify({ ok: true, result: true }), { status: 200 });
  }) as unknown as typeof fetch;
}
const sentMessages = () => calls.filter((c) => c.method === "sendMessage");

function installSqlSpy() {
  sqlLog = [];
  const original = pool.query.bind(pool) as (...args: unknown[]) => unknown;
  vi.spyOn(pool, "query").mockImplementation(((...args: unknown[]) => {
    const first = args[0] as string | { text?: string };
    sqlLog.push(typeof first === "string" ? first : first?.text ?? "");
    return original(...args);
  }) as never);
}
const sqlTouching = (table: string) => sqlLog.filter((q) => q.includes(`"${table}"`));

function webhook(update: Record<string, unknown>, updateId?: number) {
  const update_id = updateId ?? nextUpdateId++;
  updateIds.push(update_id);
  return POST(
    new NextRequest("http://localhost/api/telegram/webhook", {
      method: "POST",
      body: JSON.stringify({ update_id, ...update }),
      headers: { host: "localhost", "content-type": "application/json" },
    })
  );
}
const privateMsg = (from: number, chat: number, text: string) => ({ message: { chat: { id: chat, type: "private" }, from: { id: from }, text } });

async function cleanup() {
  await db.delete(pendingChannelRequests).where(inArray(pendingChannelRequests.telegramUserId, ALL_USERS));
  await db.delete(botPrivateChats).where(inArray(botPrivateChats.telegramUserId, ALL_USERS));
  await db.delete(users).where(inArray(users.telegramId, ALL_USERS));
  if (updateIds.length) await db.delete(telegramUpdateLog).where(inArray(telegramUpdateLog.updateId, updateIds));
  updateIds = [];
}

beforeEach(async () => {
  process.env.TELEGRAM_BOT_TOKEN = "test-token-start-fast-path";
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
  await cleanup();
  installFetchMock();
});
afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  vi.restoreAllMocks();
});
afterAll(async () => {
  process.env.TELEGRAM_BOT_TOKEN = ORIGINAL_ENV.token;
  if (ORIGINAL_ENV.secret) process.env.TELEGRAM_WEBHOOK_SECRET = ORIGINAL_ENV.secret;
  await cleanup();
});

describe("ordinary /start — new user", () => {
  it("receives the approved Welcome Message and nothing is created or recorded", async () => {
    const res = await webhook(privateMsg(NEW_USER, NEW_CHAT, "/start"));
    expect(res.status).toBe(200);

    expect(sentMessages()).toHaveLength(1);
    expect(String(sentMessages()[0].body.chat_id)).toBe(String(NEW_CHAT));
    expect(sentMessages()[0].body.text).toBe(BOT_MESSAGES.welcome);
    expect(sentMessages()[0].body.reply_markup).toBeUndefined();
    expect(sentMessages()[0].body.parse_mode).toBeUndefined();

    expect(await getPrivateChat(NEW_USER)).toBeNull();
    expect(await db.select().from(users).where(eq(users.telegramId, String(NEW_USER)))).toHaveLength(0);
  });

  it("makes exactly one Telegram API call (sendMessage) — no getMe / getChat / probe", async () => {
    await webhook(privateMsg(NEW_USER, NEW_CHAT, "/start"));
    expect(calls.map((c) => c.method)).toEqual(["sendMessage"]);
  });

  it("executes exactly ONE SQL statement: the update_id idempotency insert — no account / bot_private_chats / users query", async () => {
    installSqlSpy();
    await webhook(privateMsg(NEW_USER, NEW_CHAT, "/start"));
    expect(sqlLog).toHaveLength(1);
    expect(sqlLog[0]).toMatch(/insert into "telegram_update_log"/i);
    expect(sqlTouching("bot_private_chats")).toHaveLength(0);
    expect(sqlTouching("users")).toHaveLength(0);
    expect(sqlTouching("pending_channel_requests")).toHaveLength(0);
  });
});

describe("ordinary /start — returning user", () => {
  it("receives the byte-identical Welcome Message and the existing records are not touched", async () => {
    const [seedUser] = await db
      .insert(users)
      .values({ telegramId: String(OLD_USER), referralCode: "E2EFAST1" })
      .returning();
    await recordPrivateChat(OLD_USER, OLD_CHAT);
    const [chatBefore] = await db.select().from(botPrivateChats).where(eq(botPrivateChats.telegramUserId, String(OLD_USER)));

    await webhook(privateMsg(NEW_USER, NEW_CHAT, "/start"));
    await webhook(privateMsg(OLD_USER, OLD_CHAT, "/start"));
    expect(sentMessages()).toHaveLength(2);
    expect(sentMessages()[1].body.text).toBe(sentMessages()[0].body.text);
    expect(sentMessages()[1].body.text).toBe(BOT_MESSAGES.welcome);
    expect(sentMessages()[1].body.text).not.toBe(BOT_MESSAGES.welcomeBack);

    const [chatAfter] = await db.select().from(botPrivateChats).where(eq(botPrivateChats.telegramUserId, String(OLD_USER)));
    expect(chatAfter).toEqual(chatBefore); // lastSeenAt / updatedAt / status / chatId untouched
    const [userAfter] = await db.select().from(users).where(eq(users.telegramId, String(OLD_USER)));
    expect(userAfter).toEqual(seedUser);
  });

  it("executes exactly ONE SQL statement (the idempotency insert) even when the user is on file", async () => {
    await recordPrivateChat(OLD_USER, OLD_CHAT);
    installSqlSpy();
    await webhook(privateMsg(OLD_USER, OLD_CHAT, "/start"));
    expect(sqlLog).toHaveLength(1);
    expect(sqlLog[0]).toMatch(/insert into "telegram_update_log"/i);
  });

  it("a blocked-status private chat on file is not reactivated or otherwise written by /start", async () => {
    await recordPrivateChat(OLD_USER, OLD_CHAT);
    await db.update(botPrivateChats).set({ status: "blocked" }).where(eq(botPrivateChats.telegramUserId, String(OLD_USER)));
    await webhook(privateMsg(OLD_USER, OLD_CHAT, "/start"));
    expect((await getPrivateChat(OLD_USER))?.status).toBe("blocked");
    expect(sentMessages()[0].body.text).toBe(BOT_MESSAGES.welcome);
  });
});

describe("ordinary /start — variants and safety", () => {
  it.each(["/start@OnfileBot", "/start ref_promo", "/start@OnfileBot some-other-feature", "  /start  "])("%j is ordinary: same welcome, one SQL statement", async (text) => {
    installSqlSpy();
    await webhook(privateMsg(NEW_USER, NEW_CHAT, text));
    expect(sentMessages().map((m) => m.body.text)).toEqual([BOT_MESSAGES.welcome]);
    expect(sqlLog).toHaveLength(1);
    expect(await getPrivateChat(NEW_USER)).toBeNull();
  });

  it("a redelivered update (same update_id) still sends the Welcome Message only once (idempotency preserved)", async () => {
    const id = nextUpdateId++;
    await webhook(privateMsg(NEW_USER, NEW_CHAT, "/start"), id);
    await webhook(privateMsg(NEW_USER, NEW_CHAT, "/start"), id);
    expect(sentMessages()).toHaveLength(1);
  });

  it("the message is sent (awaited) BEFORE the webhook responds — no deferred / background delivery", async () => {
    let sentBeforeResponse = false;
    global.fetch = vi.fn(async (url: string) => {
      if (String(url).endsWith("/sendMessage")) {
        await new Promise((r) => setTimeout(r, 25));
        sentBeforeResponse = true;
      }
      return new Response(JSON.stringify({ ok: true, result: true }), { status: 200 });
    }) as unknown as typeof fetch;
    await webhook(privateMsg(NEW_USER, NEW_CHAT, "/start"));
    expect(sentBeforeResponse).toBe(true);
  });

  it("a Telegram send failure (e.g. user blocked the bot) is handled safely: still 200, nothing written", async () => {
    installFetchMock({ failSend: true });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await webhook(privateMsg(NEW_USER, NEW_CHAT, "/start"));
    expect(res.status).toBe(200);
    expect(sentMessages()).toHaveLength(1);
    expect(await getPrivateChat(NEW_USER)).toBeNull();
  });

  it("/start in a group chat sends nothing and records nothing (unchanged)", async () => {
    await webhook({ message: { chat: { id: -100777, type: "supergroup" }, from: { id: NEW_USER }, text: "/start" } });
    expect(sentMessages()).toHaveLength(0);
    expect(await getPrivateChat(NEW_USER)).toBeNull();
  });

  it("a /start from a bot account keeps its previous behaviour: reply sent, chat not recorded", async () => {
    await webhook({ message: { chat: { id: NEW_CHAT, type: "private" }, from: { id: NEW_USER, is_bot: true }, text: "/start" } });
    expect(sentMessages()).toHaveLength(1);
    expect(await getPrivateChat(NEW_USER)).toBeNull();
  });

  it("the secret-token check still runs before anything else", async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = "s3cret";
    installSqlSpy();
    const res = await POST(
      new NextRequest("http://localhost/api/telegram/webhook", {
        method: "POST",
        body: JSON.stringify({ update_id: nextUpdateId++, ...privateMsg(NEW_USER, NEW_CHAT, "/start") }),
        headers: { host: "localhost", "content-type": "application/json", "x-telegram-bot-api-secret-token": "wrong" },
      })
    );
    expect(res.status).toBe(401);
    expect(sentMessages()).toHaveLength(0);
    expect(sqlLog).toHaveLength(0);
  });
});

describe("special flows are unchanged", () => {
  it("signed /start c1_… still reads + records the private chat, welcomes a first-contact user, then sends the picker", async () => {
    const created = await createPendingChannelRequest({ telegramUserId: SIGNED_USER, sessionUserId: null, telegramProfile: null }, { method: "bot" });
    await beginBotConnect((await getPendingByToken(created.correlationToken))!.id);
    installSqlSpy();
    await webhook(privateMsg(SIGNED_USER, SIGNED_CHAT, `/start ${createBotStartPayload(created.telegramRequestId, SIGNED_USER)}`));

    expect(sqlTouching("bot_private_chats").length).toBeGreaterThanOrEqual(2); // first-contact SELECT + upsert
    expect(sentMessages()).toHaveLength(2);
    expect(sentMessages()[0].body.text).toBe(BOT_MESSAGES.welcome);
    expect(JSON.stringify(sentMessages()[1].body.reply_markup)).toContain("request_chat");
    expect(await getPrivateChat(SIGNED_USER)).toMatchObject({ chatId: String(SIGNED_CHAT), status: "active" });
  });

  it("a forged signed payload is still rejected with the invalid-link reply and the chat is still recorded", async () => {
    const created = await createPendingChannelRequest({ telegramUserId: SIGNED_USER, sessionUserId: null, telegramProfile: null }, { method: "bot" });
    await webhook(privateMsg(NEW_USER, NEW_CHAT, `/start ${createBotStartPayload(created.telegramRequestId, SIGNED_USER)}`));
    expect(String(sentMessages().at(-1)!.body.text)).toBe(BOT_MESSAGES.invalidLink);
    expect(JSON.stringify(sentMessages().map((m) => m.body.reply_markup ?? {}))).not.toContain("request_chat");
    expect(await getPrivateChat(NEW_USER)).toMatchObject({ chatId: String(NEW_CHAT) });
  });

  it("/connect and other private messages still record the private chat", async () => {
    await webhook(privateMsg(NEW_USER, NEW_CHAT, "/connect"));
    expect(sentMessages()[0].body.text).toBe(BOT_MESSAGES.noActiveRequest);
    expect(await getPrivateChat(NEW_USER)).toMatchObject({ chatId: String(NEW_CHAT) });

    await webhook(privateMsg(OLD_USER, OLD_CHAT, "hello"));
    expect(await getPrivateChat(OLD_USER)).toMatchObject({ chatId: String(OLD_CHAT) });
    expect(sentMessages()).toHaveLength(1);
  });
});
