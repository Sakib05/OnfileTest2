import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { botPrivateChats, channels, pendingChannelRequests, telegramUpdateLog, users } from "@/db/schema";
import { POST } from "./route";
import { GET as connectStatus } from "@/app/api/channels/connect-status/route";
import { POST as connectVerify } from "@/app/api/channels/connect-verify/route";
import { createSetupToken, SETUP_COOKIE_NAME } from "@/lib/setupToken";
import { beginBotConnect, createPendingChannelRequest, getPendingByToken } from "@/lib/pendingChannelRequests";
import { recordPrivateChat } from "@/lib/botPrivateChats";

/**
 * The REAL execution path of the "Channel Verification" (Verify button) message, with only Telegram's HTTP API mocked:
 *
 *   chat_shared update → POST /api/telegram/webhook → selection stored → sendMessage { chat_id, text,
 *   reply_markup.inline_keyboard[0][0].web_app } IMMEDIATELY (no getChat / getChatMember before it)
 *   → "Verify" web_app URL → POST /api/channels/connect-verify (what the Mini App calls on launch)
 *   → live getChat/getChatMember verification → channels row written.
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

// The product-approved copy, verbatim. Static: no channel title is interpolated.
const EXACT_TEXT = () => "🔐 Channel Verification\n\n🚀 Tap the button below to verify your connection.";

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
const successMessages = () => sendMessages().filter((c) => String(c.body.text).includes("🔐 Channel Verification"));

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

describe("Verify message — chat_shared (native picker result) through the real webhook", () => {
  it("sends exactly ONE sendMessage with the exact Channel Verification text and the Verify web_app button — IMMEDIATELY", async () => {
    await recordPrivateChat(USER, PRIVATE_CHAT);
    const created = await connectingRequest();
    await webhook(chatSharedUpdate(created.telegramRequestId));

    // Selected, NOT connected: nothing was verified.
    const after = (await getPendingByToken(created.correlationToken))!;
    expect(after.status).toBe("pending");
    expect(after.selectedChatId).toBe(String(CHANNEL));
    expect(await channelRows()).toHaveLength(0);
    expect(successMessages()).toHaveLength(1);

    // The complete Bot API payload, byte for byte (no parse_mode, no channel title).
    expect(successMessages()[0].body).toEqual({
      chat_id: PRIVATE_CHAT,
      text: EXACT_TEXT(),
      reply_markup: {
        inline_keyboard: [[{ text: "Verify", web_app: { url: `${MINI_APP_URL}/?connect=${created.telegramRequestId}` } }]],
      },
    });
    // No channel title at all: neither the one in the update (untrusted) nor any Telegram-verified one.
    expect(JSON.stringify(successMessages()[0].body)).not.toContain(CLIENT_SUPPLIED_TITLE);
    expect(JSON.stringify(successMessages()[0].body)).not.toContain(VERIFIED_TITLE);
    // It is the ONLY Bot API call: no getMe / getChat / getChatMember happened before (or after) it.
    expect(calls.map((c) => c.method)).toEqual(["sendMessage"]);
  });

  it("the prompt does not wait for any verification: even a channel that would FAIL verification gets the same prompt, with zero verification calls", async () => {
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
    expect(successMessages()).toHaveLength(1);
    expect(sendMessages()).toHaveLength(1);
    expect(calls.filter((c) => c.method !== "sendMessage")).toHaveLength(0);
  });
});

describe("Verify message — my_chat_member (bot promoted by the picker) can no longer bypass Verify", () => {
  it("does not connect, resolve, select or message anything — even with a pending request and the chat on file", async () => {
    await recordPrivateChat(USER, PRIVATE_CHAT);
    const created = await connectingRequest();
    await webhook(botPromotedUpdate());
    const after = (await getPendingByToken(created.correlationToken))!;
    expect(after.status).toBe("pending");
    expect(after.selectedChatId).toBeNull();
    expect(after.claimed).toBe(false);
    expect(successMessages()).toHaveLength(0);
    expect(await channelRows()).toHaveLength(0);
    // The chat_shared that follows is what produces the (single) Verify message.
    await webhook(chatSharedUpdate(created.telegramRequestId));
    expect(successMessages()).toHaveLength(1);
    expect(await channelRows()).toHaveLength(0);
  });

  it("the prompt goes to the chat the chat_shared arrived in — with NO private chat on file and no getChat probe", async () => {
    const created = await connectingRequest();
    await webhook(chatSharedUpdate(created.telegramRequestId));
    expect(successMessages()).toHaveLength(1);
    expect(successMessages()[0].body.chat_id).toBe(PRIVATE_CHAT);
    expect(calls.some((c) => c.method === "getChat")).toBe(false);
    expect(JSON.stringify(successMessages()[0].body.reply_markup)).toContain("Verify");
  });
});

describe("Verify button configuration", () => {
  it("MINI_APP_URL missing and no safe alternative: message is still sent, button is NOT silently dropped — the exact missing variable is logged", async () => {
    delete process.env.MINI_APP_URL;
    await recordPrivateChat(USER, PRIVATE_CHAT);
    const created = await connectingRequest();
    await webhook(chatSharedUpdate(created.telegramRequestId));
    expect(successMessages()).toHaveLength(1);
    expect(successMessages()[0].body.reply_markup).toEqual({ remove_keyboard: true }); // never an invented/plain URL button
    const entry = errorLog.mock.calls.find((c) => c[0] === "bot_connect_verify_button_unavailable");
    expect(entry).toBeDefined();
    expect(entry![1]).toMatchObject({ requiredEnv: "MINI_APP_URL", example: "MINI_APP_URL=https://onfile-app.vercel.app" });
  });

  it("an insecure (http) MINI_APP_URL is rejected, never sent to Telegram, and reported as invalid", async () => {
    process.env.MINI_APP_URL = "http://onfile-app.vercel.app";
    await recordPrivateChat(USER, PRIVATE_CHAT);
    const created = await connectingRequest();
    await webhook(chatSharedUpdate(created.telegramRequestId));
    expect(JSON.stringify(successMessages()[0].body)).not.toContain("http://");
    const entry = errorLog.mock.calls.find((c) => c[0] === "bot_connect_verify_button_unavailable");
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
    expect(String(sendMessages()[1].body.text)).toBe(EXACT_TEXT());
    expect(loggedErrors()).toContain("bot_connect_verify_button_rejected");
  });

  it("a Telegram failure on the confirmation is logged (never silent)", async () => {
    await recordPrivateChat(USER, PRIVATE_CHAT);
    const created = await connectingRequest();
    sendMessageReplies = [
      { ok: false, error_code: 400, description: "Bad Request: BUTTON_URL_INVALID" },
      { ok: false, error_code: 500, description: "Internal Server Error" },
    ];
    await webhook(chatSharedUpdate(created.telegramRequestId));
    expect(loggedErrors()).toContain("bot_connect_verification_prompt_failed");
  });
});

describe("Verify behaviour — the Mini App opens at the button URL and verifies the EXISTING request", () => {
  it("web_app.url → ?connect=<ref> → connect-verify answers verified with the verified channel; no second pending request exists", async () => {
    await recordPrivateChat(USER, PRIVATE_CHAT);
    const created = await connectingRequest();
    await webhook(chatSharedUpdate(created.telegramRequestId));

    const markup = successMessages()[0].body.reply_markup as { inline_keyboard: { web_app: { url: string } }[][] };
    const url = new URL(markup.inline_keyboard[0][0].web_app.url);
    expect(url.origin).toBe(MINI_APP_URL);
    expect([...url.searchParams.keys()]).toEqual(["connect"]);
    const ref = url.searchParams.get("connect")!;

    // Before the user taps Verify the status endpoint reports a selection, not a connection.
    const before = await statusReq(ref, cookieFor(USER));
    expect(await before.json()).toMatchObject({ status: "pending", stage: "channel_selected" });

    const res = await verifyReq({ ref: Number(ref) }, cookieFor(USER));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data).toMatchObject({ status: "verified", channel: { channelName: VERIFIED_TITLE } });

    // The status read afterwards agrees, and nothing new was created.
    const status = await (await statusReq(ref, cookieFor(USER))).json();
    expect(status).toMatchObject({ status: "verified", channel: { channelName: VERIFIED_TITLE } });
    const rows = await db.select().from(pendingChannelRequests).where(eq(pendingChannelRequests.telegramUserId, String(USER)));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("verified");
    // Another Telegram user presenting the same public ref can neither verify nor read it.
    const other = cookieFor(USER + 1);
    expect((await verifyReq({ ref: Number(ref) }, other)).status).toBe(404);
    expect((await statusReq(ref, other)).status).toBe(404);
  });
});

describe("Direct Picker requests (legacy, not used by the current UI) stay silent", () => {
  it("a direct-range request only stores the selection and gets no in-chat message; it is connected only by an explicit Verify", async () => {
    await recordPrivateChat(USER, PRIVATE_CHAT);
    const created = await connectingRequest("direct");
    await webhook(chatSharedUpdate(created.telegramRequestId));
    const mid = (await getPendingByToken(created.correlationToken))!;
    expect(mid.status).toBe("pending");
    expect(mid.selectedChatId).toBe(String(CHANNEL));
    expect(sendMessages()).toHaveLength(0);

    const res = await verifyReq({ token: created.correlationToken }, cookieFor(USER));
    expect((await res.json()).status).toBe("verified");
    expect((await getPendingByToken(created.correlationToken))?.status).toBe("verified");
    expect(sendMessages()).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// "Channel Verification" message + "Verify" button — the launch contract, end to end.
// Telegram's HTTP API is the only mock; the webhook route, the connect-status route and Postgres are real.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

const cookieFor = (id: number) => `${SETUP_COOKIE_NAME}=${createSetupToken({ id, first_name: "T" })}`;

function statusReq(ref: string | number, cookie?: string) {
  return connectStatus(
    new NextRequest(`http://localhost/api/channels/connect-status?ref=${ref}`, {
      headers: { host: "localhost", ...(cookie ? { cookie } : {}) },
    })
  );
}

/** The Mini App's Verify action. */
function verifyReq(body: Record<string, unknown>, cookie?: string) {
  return connectVerify(
    new NextRequest("http://localhost/api/channels/connect-verify", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { host: "localhost", "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    })
  );
}

/** Replays a delivery with an explicit update_id (Telegram re-sends the SAME update_id when it saw no 200). */
function webhookWithId(update_id: number, update: Record<string, unknown>) {
  updateIds.push(update_id);
  return POST(
    new NextRequest("http://localhost/api/telegram/webhook", {
      method: "POST",
      body: JSON.stringify({ update_id, ...update }),
      headers: { host: "localhost", "content-type": "application/json" },
    })
  );
}

const pendingRows = () => db.select().from(pendingChannelRequests).where(eq(pendingChannelRequests.telegramUserId, String(USER)));
const channelRows = () => db.select().from(channels).where(eq(channels.telegramChannelId, String(CHANNEL)));

describe("Verify button — the actual sendMessage payload", () => {
  it("POSTs exactly { chat_id, text, reply_markup.inline_keyboard[[{ text: 'Verify', web_app.url }]] } to sendMessage", async () => {
    await recordPrivateChat(USER, PRIVATE_CHAT);
    const created = await connectingRequest();
    await webhook(chatSharedUpdate(created.telegramRequestId));

    const sent = successMessages();
    expect(sent).toHaveLength(1);
    expect(sent[0].method).toBe("sendMessage");
    expect(sent[0].body).toEqual({
      chat_id: PRIVATE_CHAT,
      text: "🔐 Channel Verification\n\n🚀 Tap the button below to verify your connection.",
      reply_markup: {
        inline_keyboard: [[{ text: "Verify", web_app: { url: `https://onfile-app.vercel.app/?connect=${created.telegramRequestId}` } }]],
      },
    });
    // One row, one button, and it is a Web App button (not a plain url / callback button).
    const kb = (sent[0].body.reply_markup as { inline_keyboard: Record<string, unknown>[][] }).inline_keyboard;
    expect(kb).toHaveLength(1);
    expect(kb[0]).toHaveLength(1);
    expect(Object.keys(kb[0][0]).sort()).toEqual(["text", "web_app"]);
    expect(kb[0][0].text).toBe("Verify");
    // The old copy / label is gone from every request sent to Telegram.
    const everything = JSON.stringify(calls.map((c) => c.body));
    expect(everything).not.toContain("Return to Onfile");
    expect(everything).not.toContain("is now connected");
    expect(everything).not.toContain("Congratulations");
  });

  it("the button URL is https, is the configured Mini App origin, and carries ONLY the public request reference", async () => {
    await recordPrivateChat(USER, PRIVATE_CHAT);
    const created = await connectingRequest();
    await webhook(chatSharedUpdate(created.telegramRequestId));
    const kb = (successMessages()[0].body.reply_markup as { inline_keyboard: { web_app: { url: string } }[][] }).inline_keyboard;
    const url = new URL(kb[0][0].web_app.url);
    expect(url.protocol).toBe("https:");
    expect(url.origin).toBe(MINI_APP_URL);
    expect(url.pathname).toBe("/");
    expect([...url.searchParams.entries()]).toEqual([["connect", String(created.telegramRequestId)]]);
    const raw = JSON.stringify(successMessages()[0].body);
    expect(raw).not.toContain(created.correlationToken);
    expect(raw).not.toContain(String(USER));
    expect(raw).not.toContain(String(CHANNEL));
    expect(raw).not.toContain(process.env.TELEGRAM_BOT_TOKEN!);
  });

  it("reading the status never sends anything: only the webhook's chat_shared produces the message", async () => {
    await recordPrivateChat(USER, PRIVATE_CHAT);
    await connectingRequest();
    await statusReq(1_073_741_900, cookieFor(USER)); // the user poking the status route does not message anyone
    expect(sendMessages()).toHaveLength(0);
  });
});

describe("Verify button — webhook redelivery sends no duplicate message", () => {
  it("the SAME update_id delivered three times → one sendMessage, one channel row", async () => {
    await recordPrivateChat(USER, PRIVATE_CHAT);
    const created = await connectingRequest();
    const id = nextUpdateId++;
    const update = chatSharedUpdate(created.telegramRequestId);
    expect((await webhookWithId(id, update)).status).toBe(200);
    expect((await webhookWithId(id, update)).status).toBe(200);
    expect((await webhookWithId(id, update)).status).toBe(200);
    expect(successMessages()).toHaveLength(1);
    expect(await channelRows()).toHaveLength(0); // the webhook never connects
  });

  it("the same selection redelivered under NEW update_ids, and the my_chat_member twin → still one sendMessage", async () => {
    await recordPrivateChat(USER, PRIVATE_CHAT);
    const created = await connectingRequest();
    await webhook(chatSharedUpdate(created.telegramRequestId));
    await webhook(chatSharedUpdate(created.telegramRequestId));
    await webhook(botPromotedUpdate());
    await webhook(chatSharedUpdate(created.telegramRequestId));
    expect(successMessages()).toHaveLength(1);
    expect(sendMessages().filter((c) => String(c.body.text).includes("Channel Verification"))).toHaveLength(1);
    const [row] = await pendingRows();
    expect(row.confirmationSentAt).not.toBeNull();
  });

  it("concurrent deliveries (race) → exactly one sendMessage", async () => {
    await recordPrivateChat(USER, PRIVATE_CHAT);
    const created = await connectingRequest();
    await Promise.all([
      webhook(chatSharedUpdate(created.telegramRequestId)),
      webhook(chatSharedUpdate(created.telegramRequestId)),
      webhook(botPromotedUpdate()),
    ]);
    expect(successMessages()).toHaveLength(1);
  });
});

describe("Verify button — what the Mini App's verification call can and cannot do", () => {
  /** chat_shared → Verify message → the user taps Verify (Mini App → connect-verify). */
  async function verifiedRef() {
    await recordPrivateChat(USER, PRIVATE_CHAT);
    const created = await connectingRequest();
    await webhook(chatSharedUpdate(created.telegramRequestId));
    expect((await verifyReq({ ref: created.telegramRequestId }, cookieFor(USER))).status).toBe(200);
    return created;
  }

  it("verified + owned by the caller → 'verified' with the persisted channel (this is the only answer that may lead to the Dashboard)", async () => {
    const created = await verifiedRef();
    const res = await statusReq(created.telegramRequestId, cookieFor(USER));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toMatchObject({ status: "verified", channel: { status: "verified", channelName: VERIFIED_TITLE } });
  });

  it("retrying verification any number of times creates no pending request, no channel, no message and keeps the same answer", async () => {
    const created = await verifiedRef();
    const rowsBefore = await pendingRows();
    const messagesBefore = sendMessages().length;
    const answers: unknown[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await statusReq(created.telegramRequestId, cookieFor(USER));
      expect(res.status).toBe(200);
      const body = await res.json();
      answers.push({ status: body.status, channelId: body.channel?.id });
    }
    expect(new Set(answers.map((a) => JSON.stringify(a))).size).toBe(1);
    const rowsAfter = await pendingRows();
    expect(rowsAfter).toHaveLength(rowsBefore.length);
    expect(rowsAfter.map((r) => r.id)).toEqual(rowsBefore.map((r) => r.id));
    expect(rowsAfter[0].confirmationSentAt?.getTime()).toBe(rowsBefore[0].confirmationSentAt?.getTime());
    expect(await channelRows()).toHaveLength(1);
    expect(sendMessages()).toHaveLength(messagesBefore); // no extra Telegram traffic either
  });

  it("another user's request cannot be used: the same public ref is 'expired'/404 for them and discloses no channel", async () => {
    const created = await verifiedRef();
    const OTHER = USER + 7;
    const res = await statusReq(created.telegramRequestId, cookieFor(OTHER));
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.status).toBe("expired");
    expect(data.channel).toBeUndefined();
    expect(JSON.stringify(data)).not.toContain(VERIFIED_TITLE);
  });

  it("no identity at all (no session / setup cookie) → 401 unauthorized, never verified", async () => {
    const created = await verifiedRef();
    const res = await statusReq(created.telegramRequestId);
    expect(res.status).toBe(401);
    expect((await res.json()).status).toBe("unauthorized");
  });

  it("a forged / tampered setup cookie is rejected", async () => {
    const created = await verifiedRef();
    const forged = `${SETUP_COOKIE_NAME}=${createSetupToken({ id: USER, first_name: "T" })}x`;
    const res = await statusReq(created.telegramRequestId, forged);
    expect(res.status).toBe(401);
  });

  it("an unverified request (user has not picked a channel yet) → 'pending', no channel — cannot reach the Dashboard, even via Verify", async () => {
    await recordPrivateChat(USER, PRIVATE_CHAT);
    const created = await connectingRequest();
    const res = await statusReq(created.telegramRequestId, cookieFor(USER));
    const data = await res.json();
    expect(data.status).toBe("pending");
    expect(data.channel).toBeUndefined();
    const v = await (await verifyReq({ ref: created.telegramRequestId }, cookieFor(USER))).json();
    expect(v).toMatchObject({ status: "pending", stage: "awaiting_selection" });
    expect(await channelRows()).toHaveLength(0);
  });

  it("an expired request (server clock) → 404 'expired', even if the browser says otherwise", async () => {
    await recordPrivateChat(USER, PRIVATE_CHAT);
    const created = await connectingRequest();
    await db
      .update(pendingChannelRequests)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(pendingChannelRequests.telegramRequestId, created.telegramRequestId));
    const res = await statusReq(created.telegramRequestId, cookieFor(USER));
    expect(res.status).toBe(404);
    expect((await res.json()).status).toBe("expired");
    // …and a late selection for it does not connect anything or send the verification message.
    await webhook(chatSharedUpdate(created.telegramRequestId));
    expect(successMessages()).toHaveLength(0);
    expect(await channelRows()).toHaveLength(0);
  });

  it("invalid references (non-numeric, unknown, direct-picker range) are never 'verified'", async () => {
    await verifiedRef();
    for (const bad of ["abc", "-1", "1;drop", "99999999999"]) {
      expect((await statusReq(bad, cookieFor(USER))).status).toBe(400);
    }
    for (const unknown of ["5", "1073741999", "2147483000"]) {
      const res = await statusReq(unknown, cookieFor(USER));
      expect(res.status).toBe(404);
      expect((await res.json()).status).toBe("expired");
    }
  });

  it("a failed verification (user is not an admin) → 'failed' with a message and no channel", async () => {
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
    expect(successMessages()).toHaveLength(1); // the prompt was sent before any verification
    const verified = await (await verifyReq({ ref: created.telegramRequestId }, cookieFor(USER))).json();
    expect(verified.status).toBe("failed");
    const res = await statusReq(created.telegramRequestId, cookieFor(USER));
    const data = await res.json();
    expect(data.status).toBe("failed");
    expect(data.channel).toBeUndefined();
    expect(typeof data.error).toBe("string");
    expect(await channelRows()).toHaveLength(0);
    expect(String(sendMessages().at(-1)!.body.text)).toMatch(/^❌/);
  });

  it("verified request whose channel no longer belongs to the resolved account → 'failed' (verification_mismatch), never 'verified'", async () => {
    const created = await verifiedRef();
    const [intruder] = await db
      .insert(users)
      .values({ telegramId: String(USER + 99), referralCode: "E2ESUC99" })
      .onConflictDoUpdate({ target: users.telegramId, set: { updatedAt: new Date() } })
      .returning();
    try {
      await db
        .update(pendingChannelRequests)
        .set({ resolvedUserId: intruder.id })
        .where(eq(pendingChannelRequests.telegramRequestId, created.telegramRequestId));
      const res = await statusReq(created.telegramRequestId, cookieFor(USER));
      const data = await res.json();
      expect(data.status).toBe("failed");
      expect(data.reason).toBe("verification_mismatch");
      expect(data.channel).toBeUndefined();
    } finally {
      await db.delete(pendingChannelRequests).where(eq(pendingChannelRequests.telegramUserId, String(USER)));
      await db.delete(channels).where(eq(channels.telegramChannelId, String(CHANNEL)));
      await db.delete(users).where(eq(users.telegramId, String(USER + 99)));
    }
  });
});
