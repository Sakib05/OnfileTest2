import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { botPrivateChats, channels, pendingChannelRequests, telegramUpdateLog, users } from "@/db/schema";
import { POST } from "./route";
import { GET as connectStatus } from "@/app/api/channels/connect-status/route";
import { createSetupToken, SETUP_COOKIE_NAME } from "@/lib/setupToken";
import { beginBotConnect, createPendingChannelRequest, getPendingByToken } from "@/lib/pendingChannelRequests";
import { recordPrivateChat } from "@/lib/botPrivateChats";

/**
 * The REAL execution path of the success notification, with only Telegram's HTTP API mocked:
 *
 *   Telegram update → POST /api/telegram/webhook → claim → live getChat/getChatMember verification
 *   → channels row written → sendMessage { chat_id, text, reply_markup.inline_keyboard[0][0].web_app }
 *   → "Return to Onfile" URL → GET /api/channels/connect-status?ref= (what the Mini App calls on launch).
 *
 * Every assertion is on the payload that would be POSTed to https://api.telegram.org/bot<token>/sendMessage.
 * Needs a disposable Postgres with the schema applied (never Production).
 */

const USER = 900_800_001;
const PRIVATE_CHAT = 700_800_001; // deliberately != USER, so "sent to the stored chat id" is observable
const CHANNEL = -1_009_800_000_001;
const BOT_ID = 999_801;
const VERIFIED_TITLE = "Verified Telegram Title";
const CLIENT_SUPPLIED_TITLE = "Title Supplied By The Update (untrusted)";
const MINI_APP_URL = "https://onfile-app.vercel.app";

const EXACT_TEXT = (name: string) =>
  `✅ ${name} is now connected to your Onfile account.\n\nYour channel is ready!\n\nReturn to Onfile to automatically refresh and view your connection status.`;

const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_ENV = { ...process.env };

interface Call {
  method: string;
  body: Record<string, unknown>;
}
let calls: Call[] = [];
let updateIds: number[] = [];
let nextUpdateId = 8_800_000_000;
let accountId: number;
let sendMessageReplies: Array<{ ok: boolean; error_code?: number; description?: string }> = [];

function installTelegramMock() {
  calls = [];
  sendMessageReplies = [];
  global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const method = String(url).split("/").pop() as string;
    const body = init?.body ? JSON.parse(init.body as string) : {};
    calls.push({ method, body });
    let result: unknown = true;
    if (method === "getMe") result = { id: BOT_ID, username: "TestOnfileBot" };
    else if (method === "getChat") {
      // getChat(<user id>) is Telegram's own answer to "which private chat does the bot have with this user?"
      result = body.chat_id === USER ? { id: PRIVATE_CHAT, type: "private" } : { id: CHANNEL, type: "channel", title: VERIFIED_TITLE };
    } else if (method === "getChatMember") {
      result = body.user_id === BOT_ID ? { status: "administrator", can_post_messages: true } : { status: "creator" };
    } else if (method === "sendMessage") {
      const reply = sendMessageReplies.shift();
      if (reply && !reply.ok) {
        return new Response(JSON.stringify(reply), { status: reply.error_code ?? 400 });
      }
      result = { message_id: 1 };
    }
    return new Response(JSON.stringify({ ok: true, result }), { status: 200 });
  }) as unknown as typeof fetch;
}

const sendMessages = () => calls.filter((c) => c.method === "sendMessage");
const successMessages = () => sendMessages().filter((c) => String(c.body.text).includes("is now connected to your Onfile account"));

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

/** What Telegram sends after the native picker returns a channel. */
const chatSharedUpdate = (requestId: number) => ({
  message: {
    chat: { id: PRIVATE_CHAT, type: "private" },
    from: { id: USER },
    chat_shared: { request_id: requestId, chat_id: CHANNEL, title: CLIENT_SUPPLIED_TITLE },
  },
});

/** What Telegram sends when the picker promotes the bot to admin in the picked channel (often arrives first). */
const botPromotedUpdate = () => ({
  my_chat_member: {
    chat: { id: CHANNEL, type: "channel", title: CLIENT_SUPPLIED_TITLE },
    from: { id: USER },
    date: 1,
    old_chat_member: { status: "left", user: { id: BOT_ID } },
    new_chat_member: { status: "administrator", user: { id: BOT_ID }, can_post_messages: true },
  },
});

async function connectingRequest(method: "bot" | "direct" = "bot") {
  const created = await createPendingChannelRequest({ telegramUserId: USER, sessionUserId: accountId, telegramProfile: null }, { method });
  if (method === "bot") await beginBotConnect((await getPendingByToken(created.correlationToken))!.id);
  return created;
}

async function cleanup() {
  const ids = [String(USER)];
  await db.delete(channels).where(eq(channels.telegramChannelId, String(CHANNEL)));
  await db.delete(pendingChannelRequests).where(inArray(pendingChannelRequests.telegramUserId, ids));
  await db.delete(botPrivateChats).where(inArray(botPrivateChats.telegramUserId, ids));
  if (updateIds.length) await db.delete(telegramUpdateLog).where(inArray(telegramUpdateLog.updateId, updateIds));
  updateIds = [];
}

let errorLog: { mock: { calls: unknown[][] } };
const loggedErrors = () => errorLog.mock.calls.map((c) => c[0]);

beforeEach(async () => {
  process.env.TELEGRAM_BOT_TOKEN = "test-token-success-message-e2e";
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
  for (const k of ["MINI_APP_URL", "NEXT_PUBLIC_APP_URL", "VERCEL_PROJECT_PRODUCTION_URL", "VERCEL_URL", "VERCEL_ENV"]) delete process.env[k];
  process.env.MINI_APP_URL = MINI_APP_URL;
  installTelegramMock();
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
  await cleanup();
  const [u] = await db
    .insert(users)
    .values({ telegramId: String(USER), referralCode: "E2ESUC01" })
    .onConflictDoUpdate({ target: users.telegramId, set: { updatedAt: new Date() } })
    .returning();
  accountId = u.id;
});
afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  vi.restoreAllMocks();
});
afterAll(async () => {
  process.env = ORIGINAL_ENV;
  await cleanup();
  await db.delete(users).where(eq(users.telegramId, String(USER)));
});

describe("success message — chat_shared (native picker result) through the real webhook", () => {
  it("sends exactly ONE sendMessage with the exact text, the VERIFIED title, and the Return to Onfile web_app button", async () => {
    await recordPrivateChat(USER, PRIVATE_CHAT);
    const created = await connectingRequest();
    await webhook(chatSharedUpdate(created.telegramRequestId));

    expect((await getPendingByToken(created.correlationToken))?.status).toBe("verified");
    expect(successMessages()).toHaveLength(1);

    // The complete Bot API payload, byte for byte (no parse_mode: the title is user-controlled text).
    expect(successMessages()[0].body).toEqual({
      chat_id: String(PRIVATE_CHAT),
      text: EXACT_TEXT(VERIFIED_TITLE),
      reply_markup: {
        inline_keyboard: [[{ text: "Return to Onfile", web_app: { url: `${MINI_APP_URL}/?connect=${created.telegramRequestId}` } }]],
      },
    });
    // Title comes from the live getChat answer, never from the update.
    expect(JSON.stringify(successMessages()[0].body)).not.toContain(CLIENT_SUPPLIED_TITLE);
    // The message is sent only AFTER live verification (getChat + getChatMember for the bot AND the user).
    const order = calls.map((c) => c.method);
    expect(order.indexOf("sendMessage")).toBeGreaterThan(order.lastIndexOf("getChatMember"));
    expect(order.filter((m) => m === "getChatMember")).toHaveLength(2);
  });

  it("no verification → no success message (and the failure is explained instead)", async () => {
    await recordPrivateChat(USER, PRIVATE_CHAT);
    const created = await connectingRequest();
    const base = global.fetch;
    global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const method = String(url).split("/").pop() as string;
      if (method === "getChatMember") {
        calls.push({ method, body: JSON.parse(init!.body as string) });
        return new Response(JSON.stringify({ ok: true, result: { status: "member" } }), { status: 200 });
      }
      return base(url, init);
    }) as unknown as typeof fetch;
    await webhook(chatSharedUpdate(created.telegramRequestId));
    expect(successMessages()).toHaveLength(0);
    expect(sendMessages()).toHaveLength(1);
    expect(String(sendMessages()[0].body.text)).toMatch(/^❌/);
  });
});

describe("success message — my_chat_member (bot promoted by the picker) wins the race against chat_shared", () => {
  it("still delivers the success message + button when the private chat is already on file", async () => {
    await recordPrivateChat(USER, PRIVATE_CHAT);
    const created = await connectingRequest();
    await webhook(botPromotedUpdate());
    expect((await getPendingByToken(created.correlationToken))?.status).toBe("verified");
    expect(successMessages()).toHaveLength(1);
    expect(successMessages()[0].body).toMatchObject({
      chat_id: String(PRIVATE_CHAT),
      text: EXACT_TEXT(VERIFIED_TITLE),
      reply_markup: { inline_keyboard: [[{ text: "Return to Onfile", web_app: { url: `${MINI_APP_URL}/?connect=${created.telegramRequestId}` } }]] },
    });
    // The chat_shared that follows must not produce a second confirmation.
    await webhook(chatSharedUpdate(created.telegramRequestId));
    expect(successMessages()).toHaveLength(1);
  });

  it("REGRESSION: delivers the message even when NO private chat is on file and the update carries no chat id (Telegram getChat locates it)", async () => {
    const created = await connectingRequest();
    await webhook(botPromotedUpdate());
    expect((await getPendingByToken(created.correlationToken))?.status).toBe("verified");
    expect(successMessages()).toHaveLength(1);
    expect(successMessages()[0].body.chat_id).toBe(String(PRIVATE_CHAT));
    expect(String(successMessages()[0].body.text)).toBe(EXACT_TEXT(VERIFIED_TITLE));
    expect(JSON.stringify(successMessages()[0].body.reply_markup)).toContain("Return to Onfile");
  });

  it("when the chat genuinely cannot be located the failure is logged loudly and the confirmation is NOT consumed", async () => {
    const base = global.fetch;
    global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const method = String(url).split("/").pop() as string;
      const body = init?.body ? JSON.parse(init.body as string) : {};
      if (method === "getChat" && body.chat_id === USER) {
        calls.push({ method, body });
        return new Response(JSON.stringify({ ok: false, error_code: 400, description: "Bad Request: chat not found" }), { status: 400 });
      }
      return base(url, init);
    }) as unknown as typeof fetch;
    const created = await connectingRequest();
    await webhook(botPromotedUpdate());
    expect(successMessages()).toHaveLength(0);
    expect(loggedErrors()).toContain("bot_connect_success_not_delivered");
    const row = await db.select().from(pendingChannelRequests).where(eq(pendingChannelRequests.telegramRequestId, created.telegramRequestId));
    expect(row[0].confirmationSentAt).toBeNull();
  });
});

describe("Return to Onfile button configuration", () => {
  it("MINI_APP_URL missing and no safe alternative: message is still sent, button is NOT silently dropped — the exact missing variable is logged", async () => {
    delete process.env.MINI_APP_URL;
    await recordPrivateChat(USER, PRIVATE_CHAT);
    const created = await connectingRequest();
    await webhook(chatSharedUpdate(created.telegramRequestId));
    expect(successMessages()).toHaveLength(1);
    expect(successMessages()[0].body.reply_markup).toEqual({ remove_keyboard: true }); // never an invented/plain URL button
    const entry = errorLog.mock.calls.find((c) => c[0] === "bot_connect_return_button_unavailable");
    expect(entry).toBeDefined();
    expect(entry![1]).toMatchObject({ requiredEnv: "MINI_APP_URL", example: "MINI_APP_URL=https://onfile-app.vercel.app" });
  });

  it("an insecure (http) MINI_APP_URL is rejected, never sent to Telegram, and reported as invalid", async () => {
    process.env.MINI_APP_URL = "http://onfile-app.vercel.app";
    await recordPrivateChat(USER, PRIVATE_CHAT);
    const created = await connectingRequest();
    await webhook(chatSharedUpdate(created.telegramRequestId));
    expect(JSON.stringify(successMessages()[0].body)).not.toContain("http://");
    const entry = errorLog.mock.calls.find((c) => c[0] === "bot_connect_return_button_unavailable");
    expect(entry![1]).toMatchObject({ requiredEnv: "MINI_APP_URL", invalid: ["MINI_APP_URL"] });
  });

  it("NEXT_PUBLIC_APP_URL is an accepted explicit alternative; the deployment-specific VERCEL_URL is never used", async () => {
    delete process.env.MINI_APP_URL;
    process.env.VERCEL_URL = "onfile-app-git-abc123-team.vercel.app";
    await recordPrivateChat(USER, PRIVATE_CHAT);
    const first = await connectingRequest();
    await webhook(chatSharedUpdate(first.telegramRequestId));
    expect(successMessages()[0].body.reply_markup).toEqual({ remove_keyboard: true });

    await cleanup();
    await db.insert(users).values({ telegramId: String(USER), referralCode: "E2ESUC01" }).onConflictDoNothing();
    process.env.NEXT_PUBLIC_APP_URL = "https://onfile-app.vercel.app";
    calls = [];
    await recordPrivateChat(USER, PRIVATE_CHAT);
    const second = await connectingRequest();
    await webhook(chatSharedUpdate(second.telegramRequestId));
    expect(JSON.stringify(successMessages()[0].body.reply_markup)).toContain(`https://onfile-app.vercel.app/?connect=${second.telegramRequestId}`);
  });

  it("if Telegram rejects the inline keyboard, the failure is logged with Telegram's description and the text-only confirmation is still delivered", async () => {
    await recordPrivateChat(USER, PRIVATE_CHAT);
    const created = await connectingRequest();
    sendMessageReplies = [{ ok: false, error_code: 400, description: "Bad Request: BUTTON_URL_INVALID" }];
    await webhook(chatSharedUpdate(created.telegramRequestId));
    expect(sendMessages()).toHaveLength(2);
    expect(sendMessages()[0].body.reply_markup).toMatchObject({ inline_keyboard: expect.any(Array) });
    expect(String(sendMessages()[1].body.text)).toBe(EXACT_TEXT(VERIFIED_TITLE));
    expect(loggedErrors()).toContain("bot_connect_return_button_rejected");
  });

  it("a Telegram failure on the confirmation is logged (never silent)", async () => {
    await recordPrivateChat(USER, PRIVATE_CHAT);
    const created = await connectingRequest();
    sendMessageReplies = [
      { ok: false, error_code: 400, description: "Bad Request: BUTTON_URL_INVALID" },
      { ok: false, error_code: 500, description: "Internal Server Error" },
    ];
    await webhook(chatSharedUpdate(created.telegramRequestId));
    expect(loggedErrors()).toContain("bot_connect_success_send_failed");
  });
});

describe("Return behaviour — the Mini App opens at the button URL and sees the connected state with no new request", () => {
  it("web_app.url → ?connect=<ref> → connect-status?ref= answers verified with the verified channel; no second pending request exists", async () => {
    await recordPrivateChat(USER, PRIVATE_CHAT);
    const created = await connectingRequest();
    await webhook(chatSharedUpdate(created.telegramRequestId));

    const markup = successMessages()[0].body.reply_markup as { inline_keyboard: { web_app: { url: string } }[][] };
    const url = new URL(markup.inline_keyboard[0][0].web_app.url);
    expect(url.origin).toBe(MINI_APP_URL);
    expect([...url.searchParams.keys()]).toEqual(["connect"]);
    const ref = url.searchParams.get("connect")!;

    const cookie = `${SETUP_COOKIE_NAME}=${createSetupToken({ id: USER, first_name: "T" })}`;
    const res = await connectStatus(
      new NextRequest(`http://localhost/api/channels/connect-status?ref=${ref}`, { headers: { host: "localhost", cookie } })
    );
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data).toMatchObject({ status: "verified", channel: { channelName: VERIFIED_TITLE } });

    // Reading the status created nothing: still exactly the one request, still verified.
    const rows = await db.select().from(pendingChannelRequests).where(eq(pendingChannelRequests.telegramUserId, String(USER)));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("verified");
    // Another Telegram user presenting the same public ref learns nothing.
    const other = `${SETUP_COOKIE_NAME}=${createSetupToken({ id: USER + 1, first_name: "X" })}`;
    const denied = await connectStatus(new NextRequest(`http://localhost/api/channels/connect-status?ref=${ref}`, { headers: { host: "localhost", cookie: other } }));
    expect(denied.status).toBe(404);
  });
});

describe("Direct Picker requests (legacy, not used by the current UI) stay silent", () => {
  it("a direct-range request is verified and connected but gets no in-chat message", async () => {
    await recordPrivateChat(USER, PRIVATE_CHAT);
    const created = await connectingRequest("direct");
    await webhook(chatSharedUpdate(created.telegramRequestId));
    expect((await getPendingByToken(created.correlationToken))?.status).toBe("verified");
    expect(sendMessages()).toHaveLength(0);
  });
});
