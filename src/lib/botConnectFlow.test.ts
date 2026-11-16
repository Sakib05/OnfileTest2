import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { pendingChannelRequests } from "@/db/schema";
import {
  BOT_MESSAGES,
  buildBotChatLink,
  buildBotDeepLink,
  buildVerifyKeyboard,
  buildVerifyUrl,
  CHANNEL_SELECTION_MESSAGE,
  CHANNEL_VERIFICATION_MESSAGE,
  channelSelectionMessage,
  classifySendFailure,
  channelVerificationMessage,
  createBotStartPayload,
  getMiniAppBaseUrl,
  resolveMiniAppBaseUrl,
  handleBotTextMessage,
  parseBotCommand,
  sendChannelVerificationPrompt,
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
  beginBotConnect,
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

/** "Connect" was tapped: the 10-minute window runs and the bot may deliver the picker. */
async function connecting(p: { correlationToken: string }) {
  await beginBotConnect((await getPendingByToken(p.correlationToken))!.id);
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
    await connecting(p);
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
    await connecting(p);
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

  it("never-started user / plain /start gets the creator-focused welcome (no keyboard)", async () => {
    await start(USER_A, "/start");
    expect(sentMessages()).toHaveLength(1);
    expect(sentMessages()[0].body.text).toBe(BOT_MESSAGES.welcome);
    expect(sentMessages()[0].body.reply_markup).toBeUndefined();
    expect(sentMessages()[0].body.parse_mode).toBeUndefined();
  });

  it("returning user (isFirstContact=false) sending a plain /start does NOT get the full onboarding again", async () => {
    await handleBotTextMessage({ chatId: USER_A, chatType: "private", fromId: USER_A, text: "/start", isFirstContact: false });
    expect(sentMessages()).toHaveLength(1);
    expect(sentMessages()[0].body.text).toBe(BOT_MESSAGES.welcomeBack);
    expect(sentMessages()[0].body.text).not.toBe(BOT_MESSAGES.welcome);
  });

  it("first-time signed /start: creator welcome first, then the unchanged picker keyboard", async () => {
    const p = await createPendingChannelRequest(identity(USER_A), { method: "bot" });
    await connecting(p);
    await handleBotTextMessage({
      chatId: USER_A, chatType: "private", fromId: USER_A, isFirstContact: true,
      text: `/start ${createBotStartPayload(p.telegramRequestId, USER_A)}`,
    });
    const msgs = sentMessages();
    expect(msgs).toHaveLength(2);
    expect(msgs[0].body.text).toBe(BOT_MESSAGES.welcome);
    expect(msgs[0].body.reply_markup).toBeUndefined();
    expect(String(msgs[1].body.text)).toContain("Please select the private Telegram channel");
    expect(msgs[1].body.reply_markup).toEqual(buildChannelPickerKeyboard(p.telegramRequestId));
  });

  it("returning signed /start: only the picker, no welcome", async () => {
    const p = await createPendingChannelRequest(identity(USER_A), { method: "bot" });
    await connecting(p);
    await handleBotTextMessage({
      chatId: USER_A, chatType: "private", fromId: USER_A, isFirstContact: false,
      text: `/start ${createBotStartPayload(p.telegramRequestId, USER_A)}`,
    });
    expect(sentMessages()).toHaveLength(1);
    expect(sentMessages()[0].body.reply_markup).toEqual(buildChannelPickerKeyboard(p.telegramRequestId));
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
    await connecting(p);
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

describe("bot-guided flow copy and return link", () => {
  it("Channel Selection message is EXACTLY the approved copy (not the general welcome message)", () => {
    const EXACT =
      "📢 Please select the private Telegram channel you want to connect to your Onfile account.\n\n" +
      "Tap the button below to select your channel 👇";
    expect(channelSelectionMessage()).toBe(EXACT);
    expect(CHANNEL_SELECTION_MESSAGE).toBe(EXACT);
    expect(channelSelectionMessage.length).toBe(0); // static: nothing (not even an expiry) is interpolated
  });

  it("Channel Selection message no longer contains the old wording or the expiry sentence", () => {
    const text = channelSelectionMessage();
    expect(text).not.toContain("Welcome to Onfile Channel Connection");
    expect(text).not.toContain("administrator permissions");
    expect(text).not.toMatch(/expire/i);
    expect(text).not.toMatch(/minute/i);
  });

  it("the Channel Selection message is what the native picker button is sent with, and the 10-minute window stays server-side", async () => {
    const p = await createPendingChannelRequest(identity(USER_A), { method: "bot" });
    await connecting(p);
    const row = (await getPendingByToken(p.correlationToken))!;
    // Backend expiry logic is untouched even though the text no longer mentions it.
    const windowMs = row.expiresAt.getTime() - Date.now();
    expect(windowMs).toBeGreaterThan(9 * 60_000);
    expect(windowMs).toBeLessThanOrEqual(10 * 60_000);

    await start(USER_A, `/start ${createBotStartPayload(p.telegramRequestId, USER_A)}`);
    const picker = sentMessages().find((m) => (m.body.reply_markup as Record<string, unknown> | undefined)?.keyboard);
    expect(picker?.body.text).toBe(CHANNEL_SELECTION_MESSAGE);
    expect((picker?.body.reply_markup as { keyboard: { request_chat: { request_id: number } }[][] }).keyboard[0][0].request_chat.request_id).toBe(
      p.telegramRequestId
    );
  });

  it("verification message is exactly the approved copy", () => {
    const EXACT = "🔐 Channel Verification\n\n" + "🚀 Tap the button below to verify your connection.";
    expect(channelVerificationMessage()).toBe(EXACT);
    expect(CHANNEL_VERIFICATION_MESSAGE).toBe(EXACT);
  });

  it("verification message never contains the old wording, a placeholder or any channel title", () => {
    const text = channelVerificationMessage();
    expect(text).not.toContain("Congratulations");
    expect(text).not.toContain("Your channel connection is ready");
    expect(text).not.toContain("dashboard");
    expect(text).not.toContain("is now connected");
    expect(text).not.toContain("Return to Onfile");
    expect(text).not.toContain("{");
    expect(channelVerificationMessage.length).toBe(0); // takes no argument: nothing client-supplied can reach it
  });

  it("getMiniAppBaseUrl accepts only https and honours the documented env precedence", () => {
    expect(getMiniAppBaseUrl({ MINI_APP_URL: "https://onfile-app.example/" } as unknown as NodeJS.ProcessEnv)).toBe("https://onfile-app.example");
    // VERCEL_URL is the per-deployment hostname (often behind Deployment Protection): never used for the button.
    expect(getMiniAppBaseUrl({ VERCEL_URL: "my-app-abc123.vercel.app" } as unknown as NodeJS.ProcessEnv)).toBeNull();
    // Vercel's stable production domain is trusted only on production deployments.
    expect(getMiniAppBaseUrl({ VERCEL_PROJECT_PRODUCTION_URL: "onfile-app.vercel.app", VERCEL_ENV: "production" } as unknown as NodeJS.ProcessEnv)).toBe("https://onfile-app.vercel.app");
    expect(getMiniAppBaseUrl({ VERCEL_PROJECT_PRODUCTION_URL: "onfile-app.vercel.app", VERCEL_ENV: "preview" } as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(getMiniAppBaseUrl({ VERCEL_PROJECT_PRODUCTION_URL: "onfile-app.vercel.app" } as unknown as NodeJS.ProcessEnv)).toBeNull();
    // MINI_APP_URL wins over every alternative.
    expect(
      getMiniAppBaseUrl({ MINI_APP_URL: "https://a.example", NEXT_PUBLIC_APP_URL: "https://b.example", VERCEL_PROJECT_PRODUCTION_URL: "c.example", VERCEL_ENV: "production" } as unknown as NodeJS.ProcessEnv)
    ).toBe("https://a.example");
    expect(getMiniAppBaseUrl({ MINI_APP_URL: "https://user:pw@evil.example" } as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(getMiniAppBaseUrl({ MINI_APP_URL: "http://insecure.example", NEXT_PUBLIC_APP_URL: "https://ok.example" } as unknown as NodeJS.ProcessEnv)).toBe("https://ok.example");
    expect(getMiniAppBaseUrl({} as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(getMiniAppBaseUrl({ MINI_APP_URL: "javascript:alert(1)" } as unknown as NodeJS.ProcessEnv)).toBeNull();
  });

  it("resolveMiniAppBaseUrl reports which variable it used, or exactly which ones were set but unusable", () => {
    const env = (e: Record<string, string>) => e as unknown as NodeJS.ProcessEnv;
    expect(resolveMiniAppBaseUrl(env({ MINI_APP_URL: "https://onfile-app.vercel.app" }))).toEqual({ ok: true, baseUrl: "https://onfile-app.vercel.app", source: "MINI_APP_URL" });
    expect(resolveMiniAppBaseUrl(env({}))).toEqual({ ok: false, invalid: [] });
    expect(resolveMiniAppBaseUrl(env({ MINI_APP_URL: "http://onfile-app.vercel.app" }))).toEqual({ ok: false, invalid: ["MINI_APP_URL"] });
    expect(resolveMiniAppBaseUrl(env({ MINI_APP_URL: "ftp://x.example", NEXT_PUBLIC_APP_URL: "https://ok.example" }))).toEqual({ ok: true, baseUrl: "https://ok.example", source: "NEXT_PUBLIC_APP_URL" });
  });

  it("the Verify keyboard is a web_app button carrying only the public ref", () => {
    const env = { MINI_APP_URL: "https://onfile-app.example" } as unknown as NodeJS.ProcessEnv;
    expect(buildVerifyKeyboard(1_073_741_900, env)).toEqual({
      inline_keyboard: [[{ text: "Verify", web_app: { url: "https://onfile-app.example/?connect=1073741900" } }]],
    });
    expect(buildVerifyUrl(1_073_741_900, env)).toBe("https://onfile-app.example/?connect=1073741900");
    expect(buildVerifyKeyboard(5, {} as unknown as NodeJS.ProcessEnv)).toBeUndefined();
    // Telegram only accepts https for web_app buttons.
    expect(buildVerifyKeyboard(5, { MINI_APP_URL: "http://onfile-app.example" } as unknown as NodeJS.ProcessEnv)).toBeUndefined();
  });

  it("/start for a prepared-only request explains that Connect must be tapped first (no picker)", async () => {
    const p = await createPendingChannelRequest(identity(USER_A), { method: "bot" });
    await start(USER_A, `/start ${createBotStartPayload(p.telegramRequestId, USER_A)}`);
    expect(sentMessages()[0].body.text).toBe(BOT_MESSAGES.notConnecting);
    expect(sentMessages()[0].body.reply_markup).toBeUndefined();
  });
});

describe("creator welcome copy", () => {
  const text = BOT_MESSAGES.welcome;

  it("is exactly the approved creator-focused message", () => {
    expect(text).toBe(
      "👋 Welcome to Onfile!\n\n" +
        "Your Content. Your Audience. Your Earnings.\n\n" +
        "You already create and share valuable content with your audience. Why not earn from it too?\n\n" +
        "Onfile helps Telegram channel owners turn their files into an earning opportunity.\n\n" +
        "💰 Monetize Your Content — Earn revenue from your shared files through Onfile's monetization system.\n\n" +
        "📂 Share Without Limits — Share files with your audience through a seamless file-sharing experience.\n\n" +
        "📈 Grow Your Earnings — Turn your audience's interest in your content into potential income.\n\n" +
        "🎯 Stay in Control — Your channel, your content, your audience. You remain the owner.\n\n" +
        "Don't just share files. Make your content work for you.\n\n" +
        "Welcome to Onfile — where content creates opportunities."
    );
  });

  it("explains Onfile's purpose and the earning opportunity", () => {
    expect(text).toContain("Telegram channel owners");
    expect(text).toContain("earning opportunity");
    expect(text).toContain("Monetize Your Content");
  });

  it("contains no setup / connection / permission / button instructions", () => {
    for (const forbidden of [
      /\bconnect/i, /\bstart\b/i, /select channel/i, /administrator/i, /\badmin\b/i, /permission/i,
      /picker/i, /\btap\b/i, /\bpress\b/i, /\bclick\b/i, /private channel/i, /open onfile/i,
    ]) {
      expect(text).not.toMatch(forbidden);
    }
  });

  it("promises no guaranteed or specific income", () => {
    expect(text).not.toMatch(/guarantee/i);
    expect(text).not.toMatch(/[$€£]\s?\d|\d+\s?(usd|dollars|%)/i);
    expect(text).toContain("potential income");
  });

  it("is valid plain Telegram text: within the 4096 limit, no markup characters that would need parse_mode", () => {
    expect(text.length).toBeGreaterThan(0);
    expect(text.length).toBeLessThanOrEqual(4096);
    expect(text).not.toMatch(/[<>*_`\[\]]/);
  });

  it("the returning-user reply is short and carries no setup instructions", () => {
    expect(BOT_MESSAGES.welcomeBack.length).toBeLessThan(200);
    expect(BOT_MESSAGES.welcomeBack).not.toMatch(/connect|start|select|administrator/i);
  });
});

describe("channel picker placement (Telegram Bot API constraint)", () => {
  it("is a native ReplyKeyboardMarkup request_chat button — NOT an inline keyboard", () => {
    const kb = buildChannelPickerKeyboard(1_073_741_900) as unknown as Record<string, unknown>;
    expect(kb.inline_keyboard).toBeUndefined();
    expect(Array.isArray(kb.keyboard)).toBe(true);
    const btn = (kb.keyboard as { text: string; request_chat: Record<string, unknown> }[][])[0][0];
    expect(btn.text).toBe("Select channel to connect");
    expect(btn.request_chat).toMatchObject({
      request_id: 1_073_741_900, chat_is_channel: true, chat_has_username: false, request_title: true,
    });
    expect(btn).not.toHaveProperty("url");
    expect(btn).not.toHaveProperty("callback_data");
  });

  it("the picker message is sent with the reply keyboard (never an inline_keyboard request_chat)", async () => {
    const p = await createPendingChannelRequest(identity(USER_A), { method: "bot" });
    await connecting(p);
    await start(USER_A, `/start ${createBotStartPayload(p.telegramRequestId, USER_A)}`);
    const markup = JSON.stringify(sentMessages().at(-1)!.body.reply_markup);
    expect(markup).toContain("request_chat");
    expect(markup).not.toContain("inline_keyboard");
  });
});

describe("sendChannelVerificationPrompt — immediate Verify message", () => {
  beforeEach(() => {
    process.env.MINI_APP_URL = "https://onfile.example.test";
  });

  it("sends exactly one sendMessage straight to the given chat: exact text + Verify web_app button, no other Bot API call", async () => {
    const p = await createPendingChannelRequest(identity(USER_A), { method: "bot" });
    await connecting(p);
    const row = (await getPendingByToken(p.correlationToken))!;
    const res = await sendChannelVerificationPrompt(USER_A, 4242, { id: row.id, telegramRequestId: row.telegramRequestId });
    expect(res).toEqual({ delivered: true, buttonAttached: true });
    // No getChat / getChatMember / getMe before the message: nothing is verified or looked up first.
    expect(calls.map((c) => c.method)).toEqual(["sendMessage"]);
    expect(calls[0].body).toEqual({
      chat_id: 4242,
      text: "🔐 Channel Verification\n\n🚀 Tap the button below to verify your connection.",
      reply_markup: {
        inline_keyboard: [[{ text: "Verify", web_app: { url: `https://onfile.example.test/?connect=${row.telegramRequestId}` } }]],
      },
    });
  });

  it("is sent at most once per request (a duplicate delivery is skipped without calling Telegram)", async () => {
    const p = await createPendingChannelRequest(identity(USER_A), { method: "bot" });
    await connecting(p);
    const row = (await getPendingByToken(p.correlationToken))!;
    const ref = { id: row.id, telegramRequestId: row.telegramRequestId };
    const results = await Promise.all([
      sendChannelVerificationPrompt(USER_A, 4242, ref),
      sendChannelVerificationPrompt(USER_A, 4242, ref),
      sendChannelVerificationPrompt(USER_A, 4242, ref),
    ]);
    expect(results.filter((r) => r.delivered)).toHaveLength(1);
    expect(results.filter((r) => !r.delivered && r.reason === "duplicate")).toHaveLength(2);
    expect(sentMessages()).toHaveLength(1);
  });

  it("when Telegram definitively rejects the message the reservation is released so a re-selection can retry", async () => {
    const p = await createPendingChannelRequest(identity(USER_A), { method: "bot" });
    await connecting(p);
    const row = (await getPendingByToken(p.correlationToken))!;
    const ref = { id: row.id, telegramRequestId: row.telegramRequestId };
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: false, error_code: 500, description: "Internal Server Error" }), { status: 500 })
    ) as unknown as typeof fetch;
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await sendChannelVerificationPrompt(USER_A, 4242, ref)).toEqual({ delivered: false, reason: "send_failed" });
    expect(errSpy).toHaveBeenCalledWith("bot_connect_verification_prompt_failed", expect.objectContaining({ pendingId: row.id }));
    mockTelegram();
    expect(await sendChannelVerificationPrompt(USER_A, 4242, ref)).toEqual({ delivered: true, buttonAttached: true });
  });

  it("without an https Mini App URL the failure is logged loudly naming MINI_APP_URL and the text-only message is still sent", async () => {
    delete process.env.MINI_APP_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;
    const p = await createPendingChannelRequest(identity(USER_A), { method: "bot" });
    await connecting(p);
    const row = (await getPendingByToken(p.correlationToken))!;
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await sendChannelVerificationPrompt(USER_A, 4242, { id: row.id, telegramRequestId: row.telegramRequestId });
    expect(res).toEqual({ delivered: true, buttonAttached: false });
    expect(errSpy).toHaveBeenCalledWith("bot_connect_verify_button_unavailable", expect.objectContaining({ requiredEnv: "MINI_APP_URL" }));
  });
});
