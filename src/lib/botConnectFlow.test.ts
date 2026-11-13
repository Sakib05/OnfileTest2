import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { pendingChannelRequests } from "@/db/schema";
import {
  BOT_MESSAGES,
  buildBotChatLink,
  buildBotDeepLink,
  classifySendFailure,
  createBotStartPayload,
  handleBotTextMessage,
  parseBotCommand,
  verifyBotStartPayload,
} from "@/lib/botConnectFlow";
import {
  buildChannelPickerKeyboard,
  buildRequestChatCriteria,
  createPreparedChatRequestButton,
  REQUIRED_BOT_ADMIN_RIGHTS,
  REQUIRED_USER_ADMIN_RIGHTS,
} from "@/lib/telegramBot";
import {
  connectMethodForRequestId,
  createPendingChannelRequest,
  getPendingByToken,
  updatePendingChannelRequestById,
} from "@/lib/pendingChannelRequests";
import type { ResolvedConnectingIdentity } from "@/lib/channelConnection";

const USER_A = 900_100_001;
const USER_B = 900_100_002;
const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

const identity = (id: number): ResolvedConnectingIdentity => ({ telegramUserId: id, sessionUserId: null, telegramProfile: null });

interface SentCall {
  method: string;
  body: Record<string, unknown>;
}
let calls: SentCall[] = [];

function mockTelegram() {
  calls = [];
  global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const method = String(url).split("/").pop() as string;
    const body = init?.body ? JSON.parse(init.body as string) : {};
    calls.push({ method, body });
    const result =
      method === "savePreparedKeyboardButton" ? { id: "prepared-1" } : method === "getMe" ? { id: 999, username: "TestOnfileBot" } : true;
    return new Response(JSON.stringify({ ok: true, result }), { status: 200 });
  }) as unknown as typeof fetch;
}

async function cleanup() {
  for (const id of [USER_A, USER_B]) {
    await db.delete(pendingChannelRequests).where(eq(pendingChannelRequests.telegramUserId, String(id)));
  }
}

beforeEach(async () => {
  process.env.TELEGRAM_BOT_TOKEN = "test-token-bot-connect";
  mockTelegram();
  await cleanup();
});
afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  process.env.TELEGRAM_BOT_TOKEN = ORIGINAL_TOKEN;
  vi.restoreAllMocks();
});
afterAll(cleanup);

function start(fromId: number, text: string, chatType = "private") {
  return handleBotTextMessage({ chatId: fromId, chatType, fromId, text });
}
const sentMessages = () => calls.filter((c) => c.method === "sendMessage");

describe("signed /start payload", () => {
  it("round-trips for the intended user and is a valid Telegram start parameter", () => {
    const payload = createBotStartPayload(1_500_000_000, USER_A);
    expect(payload).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(verifyBotStartPayload(payload, USER_A)).toEqual({ ok: true, requestId: 1_500_000_000 });
  });

  it("is rejected for a different Telegram user (forwarded link)", () => {
    const payload = createBotStartPayload(1_500_000_000, USER_A);
    expect(verifyBotStartPayload(payload, USER_B)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("is rejected when the request id or signature is tampered with", () => {
    const payload = createBotStartPayload(1_500_000_000, USER_A);
    const [v, , mac] = payload.split("_");
    expect(verifyBotStartPayload(`${v}_${(1_500_000_001).toString(36)}_${mac}`, USER_A).ok).toBe(false);
    expect(verifyBotStartPayload(`${v}_${(1_500_000_000).toString(36)}_${"0".repeat(24)}`, USER_A).ok).toBe(false);
  });

  it("rejects malformed / arbitrary start parameters", () => {
    for (const bad of ["", "c1_", "hello", "c1_zzzz", "c1_abc_xyz", "c2_abc_" + "a".repeat(24), "c1_" + "a".repeat(12) + "_" + "a".repeat(24)]) {
      expect(verifyBotStartPayload(bad, USER_A).ok).toBe(false);
    }
  });

  it("does not embed the bot token / secret in the payload", () => {
    expect(createBotStartPayload(1_500_000_000, USER_A)).not.toContain("test-token-bot-connect");
  });

  it("builds the deep link from the supplied (configured) bot username", () => {
    expect(buildBotDeepLink("MyConfiguredBot", "c1_a_b")).toBe("https://t.me/MyConfiguredBot?start=c1_a_b");
  });
});

describe("parseBotCommand", () => {
  it("parses start with and without payload and @botname suffix", () => {
    expect(parseBotCommand("/start")).toEqual({ command: "start", arg: "" });
    expect(parseBotCommand("/start c1_a_b")).toEqual({ command: "start", arg: "c1_a_b" });
    expect(parseBotCommand("/start@OnfileBot c1_a_b")).toEqual({ command: "start", arg: "c1_a_b" });
    expect(parseBotCommand("hello")).toBeNull();
  });
});

describe("request-chat criteria — identical for Direct Picker and bot keyboard", () => {
  it("keeps the existing private-channel + rights criteria unchanged", () => {
    expect(buildRequestChatCriteria(42)).toEqual({
      request_id: 42,
      chat_is_channel: true,
      chat_has_username: false,
      bot_administrator_rights: REQUIRED_BOT_ADMIN_RIGHTS,
      user_administrator_rights: REQUIRED_USER_ADMIN_RIGHTS,
      request_title: true,
    });
  });

  it("Direct Picker (savePreparedKeyboardButton) still sends exactly those criteria", async () => {
    await createPreparedChatRequestButton("test-token-bot-connect", USER_A, 77);
    // getMe is called first to resolve the bot id; find the prepared-button call.
    const prepared = calls.find((c) => c.method === "savePreparedKeyboardButton");
    expect(prepared?.body).toEqual({
      user_id: USER_A,
      button: { text: "Select channel to connect", request_chat: JSON.parse(JSON.stringify(buildRequestChatCriteria(77))) },
    });
  });

  it("bot keyboard is a ReplyKeyboardMarkup whose only button is a request_chat button with the same criteria", () => {
    const kb = buildChannelPickerKeyboard(1_200_000_000);
    expect(kb.keyboard).toHaveLength(1);
    expect(kb.keyboard[0]).toHaveLength(1);
    expect(kb.keyboard[0][0].request_chat).toEqual(buildRequestChatCriteria(1_200_000_000));
    expect(kb.keyboard[0][0].request_chat.chat_has_username).toBe(false);
    expect(kb.keyboard[0][0].request_chat.chat_is_channel).toBe(true);
    // Not an inline keyboard / plain text.
    expect(kb).not.toHaveProperty("inline_keyboard");
  });
});

describe("request id ranges (connection method tagging)", () => {
  it("direct requests stay in the original range; bot requests use the bot range", async () => {
    const direct = await createPendingChannelRequest(identity(USER_A));
    const bot = await createPendingChannelRequest(identity(USER_A), { method: "bot" });
    expect(connectMethodForRequestId(direct.telegramRequestId)).toBe("direct");
    expect(connectMethodForRequestId(bot.telegramRequestId)).toBe("bot");
    expect(bot.telegramRequestId).toBeLessThan(2_147_483_647);
  });
});

describe("handleBotTextMessage — /start", () => {
  it("valid payload: replies with the request_chat keyboard bound to THE pending request", async () => {
    const p = await createPendingChannelRequest(identity(USER_A), { method: "bot" });
    const payload = createBotStartPayload(p.telegramRequestId, USER_A);

    expect(await start(USER_A, `/start ${payload}`)).toBe(true);

    const msgs = sentMessages();
    expect(msgs).toHaveLength(1);
    expect(msgs[0].body.chat_id).toBe(USER_A);
    const markup = msgs[0].body.reply_markup as ReturnType<typeof buildChannelPickerKeyboard>;
    expect(markup.keyboard[0][0].request_chat.request_id).toBe(p.telegramRequestId);
    expect(markup.keyboard[0][0].request_chat.chat_has_username).toBe(false);
    expect(msgs[0].body).not.toHaveProperty("parse_mode");
    // Starting must NOT claim/resolve the request.
    expect((await getPendingByToken(p.correlationToken))?.status).toBe("pending");
  });

  it("works when pressed again (already-started user / re-tapped link) while still pending", async () => {
    const p = await createPendingChannelRequest(identity(USER_A), { method: "bot" });
    const payload = createBotStartPayload(p.telegramRequestId, USER_A);
    await start(USER_A, `/start ${payload}`);
    await start(USER_A, `/start ${payload}`);
    expect(sentMessages().filter((m) => m.body.reply_markup)).toHaveLength(2);
  });

  it("wrong Telegram user is rejected — no keyboard is sent", async () => {
    const p = await createPendingChannelRequest(identity(USER_A), { method: "bot" });
    const payload = createBotStartPayload(p.telegramRequestId, USER_A);

    await start(USER_B, `/start ${payload}`);

    const msgs = sentMessages();
    expect(msgs).toHaveLength(1);
    expect(msgs[0].body.text).toBe(BOT_MESSAGES.invalidLink);
    expect(msgs[0].body.reply_markup).toBeUndefined();
  });

  it("wrong user is rejected even with a payload correctly signed for them but someone else's request", async () => {
    const p = await createPendingChannelRequest(identity(USER_A), { method: "bot" });
    const forged = createBotStartPayload(p.telegramRequestId, USER_B); // valid MAC for B, but the row belongs to A
    await start(USER_B, `/start ${forged}`);
    expect(sentMessages()[0].body.text).toBe(BOT_MESSAGES.invalidLink);
    expect(sentMessages()[0].body.reply_markup).toBeUndefined();
  });

  it("expired request is rejected with the expiry message", async () => {
    const p = await createPendingChannelRequest(identity(USER_A), { method: "bot" });
    const pending = await getPendingByToken(p.correlationToken);
    await db
      .update(pendingChannelRequests)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(pendingChannelRequests.id, pending!.id));

    await start(USER_A, `/start ${createBotStartPayload(p.telegramRequestId, USER_A)}`);
    expect(sentMessages()[0].body.text).toBe(BOT_MESSAGES.expired);
    expect(sentMessages()[0].body.reply_markup).toBeUndefined();
  });

  it("replayed (already completed) request is rejected", async () => {
    const p = await createPendingChannelRequest(identity(USER_A), { method: "bot" });
    const pending = await getPendingByToken(p.correlationToken);
    await updatePendingChannelRequestById(pending!.id, { status: "verified" });

    await start(USER_A, `/start ${createBotStartPayload(p.telegramRequestId, USER_A)}`);
    expect(sentMessages()[0].body.text).toBe(BOT_MESSAGES.alreadyUsed);
    expect(sentMessages()[0].body.reply_markup).toBeUndefined();
  });

  it("a Direct Picker request id can never be used through the bot /start path", async () => {
    const p = await createPendingChannelRequest(identity(USER_A)); // direct
    await start(USER_A, `/start ${createBotStartPayload(p.telegramRequestId, USER_A)}`);
    expect(sentMessages()[0].body.text).toBe(BOT_MESSAGES.invalidLink);
    expect(sentMessages()[0].body.reply_markup).toBeUndefined();
  });

  it("never-started user / plain /start gets an explanation of how to connect", async () => {
    await start(USER_A, "/start");
    expect(sentMessages()[0].body.text).toBe(BOT_MESSAGES.welcome);
    expect(sentMessages()[0].body.reply_markup).toBeUndefined();
  });

  it("garbage payloads get the invalid-link message", async () => {
    await start(USER_A, "/start c1_garbage");
    expect(sentMessages()[0].body.text).toBe(BOT_MESSAGES.invalidLink);
  });

  it("ignores non-private chats and non-commands", async () => {
    expect(await start(USER_A, "/start", "group")).toBe(false);
    expect(await start(USER_A, "hello there")).toBe(false);
    expect(sentMessages()).toHaveLength(0);
  });
});

describe("handleBotTextMessage — /connect", () => {
  it("re-sends the keyboard for the latest active bot request", async () => {
    const p = await createPendingChannelRequest(identity(USER_A), { method: "bot" });
    await start(USER_A, "/connect");
    const markup = sentMessages()[0].body.reply_markup as ReturnType<typeof buildChannelPickerKeyboard>;
    expect(markup.keyboard[0][0].request_chat.request_id).toBe(p.telegramRequestId);
  });

  it("does not surface a Direct Picker request or another user's request", async () => {
    await createPendingChannelRequest(identity(USER_A)); // direct
    await createPendingChannelRequest(identity(USER_B), { method: "bot" });
    await start(USER_A, "/connect");
    expect(sentMessages()[0].body.text).toBe(BOT_MESSAGES.noActiveRequest);
    expect(sentMessages()[0].body.reply_markup).toBeUndefined();
  });
});

describe("returning-user helpers", () => {
  it("buildBotChatLink is the plain chat link of the given bot — never a ?start= link", () => {
    expect(buildBotChatLink("AnyConfiguredBot")).toBe("https://t.me/AnyConfiguredBot");
    expect(buildBotChatLink("AnyConfiguredBot")).not.toContain("start=");
    // The start deep link remains available for first-time users.
    expect(buildBotDeepLink("AnyConfiguredBot", "c1_a_b")).toBe("https://t.me/AnyConfiguredBot?start=c1_a_b");
  });

  it("classifySendFailure distinguishes blocked / never-started / invalid chat / other Telegram errors", () => {
    const f = (errorCode: number | undefined, description: string) => classifySendFailure({ ok: false, errorCode, description });
    expect(f(403, "Forbidden: bot was blocked by the user")).toBe("bot_blocked");
    expect(f(403, "Forbidden: user is deactivated")).toBe("bot_blocked");
    expect(f(403, "Forbidden: bot can't initiate conversation with a user")).toBe("no_chat");
    expect(f(400, "Bad Request: chat not found")).toBe("chat_invalid");
    expect(f(429, "Too Many Requests: retry after 5")).toBe("telegram_api_error");
    expect(f(500, "Internal Server Error")).toBe("telegram_api_error");
    expect(f(undefined, "request_timed_out")).toBe("telegram_api_error");
    expect(f(400, "Bad Request: USER_RIGHTS_MISSING")).toBe("telegram_api_error");
  });
});
