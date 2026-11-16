import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { channels, pendingChannelRequests, telegramUpdateLog, users } from "@/db/schema";
import { POST } from "./route";
import { POST as VERIFY } from "@/app/api/channels/connect-verify/route";
import { createSetupToken, SETUP_COOKIE_NAME } from "@/lib/setupToken";
import { createBotStartPayload } from "@/lib/botConnectFlow";
import { CHANNEL_FAILURE_MESSAGES } from "@/lib/channelConnection";
import { beginBotConnect, createPendingChannelRequest, getPendingByToken } from "@/lib/pendingChannelRequests";
import { BOT_MESSAGES, CHANNEL_SELECTION_MESSAGE, CHANNEL_VERIFICATION_MESSAGE } from "@/lib/botConnectFlow";

const BOT_WELCOME = BOT_MESSAGES.welcome;

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
const pickerMessage = () => userMessages().find((m) => (m.body.reply_markup as Record<string, unknown> | undefined)?.keyboard);
/** Bot API calls that VERIFY a channel — none of these may happen before the user taps Verify. */
const verificationCalls = () => sent.filter((c) => ["getChat", "getChatMember", "getMe"].includes(c.method));

const cookieFor = (id: number) => `${SETUP_COOKIE_NAME}=${createSetupToken({ id, first_name: "T" })}`;
/** The Mini App's Verify action: POST /api/channels/connect-verify as the authenticated Telegram user. */
function verify(body: Record<string, unknown>, asUser: number | null = USER_A) {
  return VERIFY(
    new NextRequest("http://localhost/api/channels/connect-verify", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { host: "localhost", "content-type": "application/json", ...(asUser ? { cookie: cookieFor(asUser) } : {}) },
    })
  );
}
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
    // A first-time user also gets the (unchanged) welcome message; the picker is the keyboard message.
    const msg = pickerMessage()!;
    expect(msg.body.text).toBe(CHANNEL_SELECTION_MESSAGE);
    const markup = msg.body.reply_markup as { keyboard: { request_chat: { request_id: number; chat_has_username: boolean; chat_is_channel: boolean } }[][] };
    expect(markup.keyboard[0][0].request_chat.request_id).toBe(telegramRequestId);
    expect(markup.keyboard[0][0].request_chat.chat_is_channel).toBe(true);
    expect(markup.keyboard[0][0].request_chat.chat_has_username).toBe(false);
  });
});

describe("chat_shared — stores the selection and sends the Verify message immediately, verifying NOTHING", () => {
  it("sends the exact Channel Verification message + Verify button as the ONLY Bot API call, and connects nothing", async () => {
    const { telegramRequestId, correlationToken } = await newBotRequest();
    const res = await chatShared(USER_A, telegramRequestId);
    expect(res.status).toBe(200);

    // No getMe / getChat / getChatMember: no channel verification happened before the message.
    expect(verificationCalls()).toHaveLength(0);
    expect(sent.map((c) => c.method)).toEqual(["sendMessage"]);

    const note = userMessages()[0];
    expect(note.body.text).toBe("🔐 Channel Verification\n\n🚀 Tap the button below to verify your connection.");
    expect(note.body.text).toBe(CHANNEL_VERIFICATION_MESSAGE);
    expect(note.body.reply_markup).toEqual({
      inline_keyboard: [[{ text: "Verify", web_app: { url: `https://onfile.example.test/?connect=${telegramRequestId}` } }]],
    });
    // Goes to the private chat the update arrived in (not a user-id assumption).
    expect(String(note.body.chat_id)).toBe(String(USER_A));

    // The selection is stored against the request, but NOTHING is connected or resolved.
    expect(await connectedRows()).toHaveLength(0);
    const after = (await getPendingByToken(correlationToken))!;
    expect(after.status).toBe("pending");
    expect(after.lifecycle).toBe("channel_selected");
    expect(after.selectedChatId).toBe(String(CHAT_ID));
    expect(after.resolvedUserId).toBeNull();
    expect(after.claimed).toBe(false);
  });

  it("never reports the channel as connected — not even when the channel would fail verification", async () => {
    scenario.chat.username = "some_public_channel"; // would be rejected by verification — but nothing verifies yet
    const { telegramRequestId, correlationToken } = await newBotRequest();
    await chatShared(USER_A, telegramRequestId);
    expect(userMessages()).toHaveLength(1);
    expect(String(userMessages()[0].body.text)).not.toMatch(/connected|congrat|ready|failed|❌/i);
    expect((await getPendingByToken(correlationToken))?.status).toBe("pending");
    expect(await connectedRows()).toHaveLength(0);
  });

  it("rejects the wrong Telegram user — nothing is stored, connected or sent", async () => {
    const { telegramRequestId, correlationToken } = await newBotRequest();
    await chatShared(USER_B, telegramRequestId);

    expect(await connectedRows()).toHaveLength(0);
    const after = (await getPendingByToken(correlationToken))!;
    expect(after.status).toBe("pending");
    expect(after.selectedChatId).toBeNull();
    expect(userMessages()).toHaveLength(0);
    expect(verificationCalls()).toHaveLength(0);
  });

  it("rejects an expired request, tells the user, stores nothing", async () => {
    const { telegramRequestId, pending } = await newBotRequest();
    await db.update(pendingChannelRequests).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(pendingChannelRequests.id, pending.id));

    await chatShared(USER_A, telegramRequestId);

    expect(await connectedRows()).toHaveLength(0);
    expect(String(userMessages().at(-1)!.body.text)).toContain("expired");
    expect(JSON.stringify(userMessages().at(-1)!.body.reply_markup ?? {})).not.toContain("Verify");
    expect(verificationCalls()).toHaveLength(0);
    const [row] = await db.select().from(pendingChannelRequests).where(eq(pendingChannelRequests.id, pending.id));
    expect(row.selectedChatId).toBeNull();
  });

  it("a replayed selection (new update_id, same request) sends no second message and creates no connection", async () => {
    const { telegramRequestId } = await newBotRequest();
    await chatShared(USER_A, telegramRequestId);
    await chatShared(USER_A, telegramRequestId);
    await chatShared(USER_A, telegramRequestId);
    expect(userMessages().filter((m) => String(m.body.text).includes("Channel Verification"))).toHaveLength(1);
    expect(await connectedRows()).toHaveLength(0);
    expect(verificationCalls()).toHaveLength(0);
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
    await Promise.all([mk(), mk()]);
    expect(sent.length).toBe(n);
    expect(userMessages()).toHaveLength(1);
    expect(await connectedRows()).toHaveLength(0);
  });

  it("two simultaneous pending bot requests are handled independently by their own request ids", async () => {
    const first = await newBotRequest();
    const second = await newBotRequest();
    await chatShared(USER_A, second.telegramRequestId);

    expect((await getPendingByToken(second.correlationToken))?.selectedChatId).toBe(String(CHAT_ID));
    expect((await getPendingByToken(first.correlationToken))?.selectedChatId).toBeNull();
    expect(await connectedRows()).toHaveLength(0);
  });

  it("re-sharing a different channel before Verify replaces the selection for the SAME request (still one prompt)", async () => {
    const { telegramRequestId, correlationToken } = await newBotRequest();
    await chatShared(USER_A, telegramRequestId, CHAT_ID);
    await chatShared(USER_A, telegramRequestId, CHAT_ID - 1);
    expect((await getPendingByToken(correlationToken))?.selectedChatId).toBe(String(CHAT_ID - 1));
    expect(userMessages()).toHaveLength(1);
  });

  it("a malformed chat_shared payload is ignored (nothing stored, nothing sent)", async () => {
    const { telegramRequestId, correlationToken } = await newBotRequest();
    await webhook({
      message: { chat: { id: USER_A, type: "private" }, from: { id: USER_A }, chat_shared: { request_id: telegramRequestId, chat_id: "not-a-number" } },
    });
    expect(userMessages()).toHaveLength(0);
    expect((await getPendingByToken(correlationToken))?.selectedChatId).toBeNull();
  });

  it("my_chat_member (bot promoted to admin) can NOT finalize or resolve a pending request any more", async () => {
    const { correlationToken } = await newBotRequest();
    await webhook({
      my_chat_member: {
        chat: { id: CHAT_ID, type: "channel", title: "My Private Channel" },
        from: { id: USER_A },
        date: Math.floor(Date.now() / 1000),
        old_chat_member: { status: "left", user: { id: BOT_ID } },
        new_chat_member: { status: "administrator", user: { id: BOT_ID }, can_post_messages: true },
      },
    });
    expect(await connectedRows()).toHaveLength(0);
    const after = (await getPendingByToken(correlationToken))!;
    expect(after.status).toBe("pending");
    expect(after.selectedChatId).toBeNull();
    expect(after.claimed).toBe(false);
    expect(userMessages()).toHaveLength(0);
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

  it("a legacy Direct Picker request also only stores the selection: no connection, no bot-chat message", async () => {
    const { telegramRequestId, correlationToken } = await newBotRequest("direct");
    await chatShared(USER_A, telegramRequestId);

    const after = (await getPendingByToken(correlationToken))!;
    expect(after.status).toBe("pending");
    expect(after.selectedChatId).toBe(String(CHAT_ID));
    expect(await connectedRows()).toHaveLength(0);
    expect(userMessages()).toHaveLength(0);
    expect(verificationCalls()).toHaveLength(0);
  });
});

describe("Verify in the Mini App — the ONLY place the channel is verified and connected", () => {
  async function selected() {
    const req = await newBotRequest();
    await chatShared(USER_A, req.telegramRequestId);
    expect(verificationCalls()).toHaveLength(0);
    sent.length = 0; // from here on, only what Verify causes is visible
    return req;
  }

  it("clicking Verify runs the live Telegram verification, connects the channel to the right account, exactly once", async () => {
    const { telegramRequestId, correlationToken } = await selected();
    const res = await verify({ ref: telegramRequestId });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.status).toBe("verified");
    expect(data.channel).toMatchObject({ status: "verified", telegramChannelId: String(CHAT_ID) });

    // The Bot API checks happened NOW (after Verify), against the channel the webhook stored.
    expect(sent.some((c) => c.method === "getChat" && String(c.body.chat_id) === String(CHAT_ID))).toBe(true);
    expect(sent.filter((c) => c.method === "getChatMember")).toHaveLength(2); // the bot AND the user

    const rows = await connectedRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: accountA, status: "verified", botIsAdmin: true });

    const after = (await getPendingByToken(correlationToken))!;
    expect(after.status).toBe("verified");
    expect(after.resolvedUserId).toBe(accountA);
    // The bot never announces a connection in chat (the Mini App shows the success state).
    expect(userMessages()).toHaveLength(0);
  });

  it("repeated Verify taps / refreshes keep answering 'verified' without re-verifying or duplicating the connection", async () => {
    const { telegramRequestId } = await selected();
    expect((await (await verify({ ref: telegramRequestId })).json()).status).toBe("verified");
    const callsAfterFirst = sent.length;
    for (let i = 0; i < 3; i++) expect((await (await verify({ ref: telegramRequestId })).json()).status).toBe("verified");
    expect(sent.length).toBe(callsAfterFirst);
    expect(await connectedRows()).toHaveLength(1);
  });

  it("simultaneous Verify calls (double tap / two devices) finalize exactly once", async () => {
    const { telegramRequestId } = await selected();
    const results = await Promise.all([1, 2, 3, 4].map(() => verify({ ref: telegramRequestId }).then((r) => r.json())));
    expect(results.some((r) => r.status === "verified")).toBe(true);
    for (const r of results) expect(["verified", "pending"]).toContain(r.status);
    expect(sent.filter((c) => c.method === "getChat")).toHaveLength(1); // one verification, not four
    expect(await connectedRows()).toHaveLength(1);
    expect((await (await verify({ ref: telegramRequestId })).json()).status).toBe("verified");
  });

  it("Verify before any channel was shared verifies nothing and connects nothing", async () => {
    const { telegramRequestId } = await newBotRequest();
    const data = await (await verify({ ref: telegramRequestId })).json();
    expect(data).toMatchObject({ status: "pending", stage: "awaiting_selection" });
    expect(verificationCalls()).toHaveLength(0);
    expect(await connectedRows()).toHaveLength(0);
  });

  it("an unauthenticated caller is rejected (401) and nothing happens", async () => {
    const { telegramRequestId, correlationToken } = await selected();
    const res = await verify({ ref: telegramRequestId }, null);
    expect(res.status).toBe(401);
    expect((await res.json()).status).toBe("unauthorized");
    expect(sent).toHaveLength(0);
    expect(await connectedRows()).toHaveLength(0);
    expect((await getPendingByToken(correlationToken))?.claimed).toBe(false);
  });

  it("another Telegram user cannot verify (or connect) someone else's request — it looks like an unknown request", async () => {
    const { telegramRequestId, correlationToken } = await selected();
    const res = await verify({ ref: telegramRequestId }, USER_B);
    expect(res.status).toBe(404);
    expect((await res.json()).status).toBe("expired");
    expect(sent).toHaveLength(0);
    expect(await connectedRows()).toHaveLength(0);
    expect((await getPendingByToken(correlationToken))?.status).toBe("pending");
  });

  it("an expired request is rejected: no Telegram calls, nothing connected", async () => {
    const { telegramRequestId, pending } = await selected();
    await db.update(pendingChannelRequests).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(pendingChannelRequests.id, pending.id));
    const res = await verify({ ref: telegramRequestId });
    expect(res.status).toBe(404);
    expect((await res.json()).status).toBe("expired");
    expect(sent).toHaveLength(0);
    expect(await connectedRows()).toHaveLength(0);
  });

  it("an invalid / unknown reference is rejected", async () => {
    expect((await verify({ ref: 1_900_000_000 })).status).toBe(404);
    expect((await verify({ ref: "abc" })).status).toBe(400);
    expect((await verify({})).status).toBe(400);
    expect(await connectedRows()).toHaveLength(0);
  });

  it("the client cannot choose the channel: a channel id in the body is ignored, the stored selection is used", async () => {
    const { telegramRequestId } = await selected();
    await verify({ ref: telegramRequestId, chatId: "-1005555555555", channelId: "-1005555555555", telegramUserId: USER_B });
    const chats = sent.filter((c) => c.method === "getChat").map((c) => String(c.body.chat_id));
    expect(chats).toEqual([String(CHAT_ID)]);
    expect((await connectedRows())[0]?.userId).toBe(accountA);
  });

  const failureCases: [string, () => void, string][] = [
    ["a public channel (private-only rule)", () => { scenario.chat.username = "some_public_channel"; }, "channel_is_public"],
    ["a non-channel chat (e.g. a group)", () => { scenario.chat = { id: CHAT_ID, type: "supergroup", title: "A group" }; }, "not_a_channel"],
    ["a bot that is not an administrator", () => { scenario.botMember = { status: "member" }; }, "bot_not_admin"],
    ["a bot without permission to post", () => { scenario.botMember = { status: "administrator", can_post_messages: false }; }, "bot_missing_permissions"],
    ["a user who is not an administrator of the channel", () => { scenario.userMember = { status: "member" }; }, "user_not_admin"],
  ];
  for (const [label, arrange, reason] of failureCases) {
    it(`rejects ${label}: failed with a clear message, never connected, never re-verifiable`, async () => {
      const { telegramRequestId, correlationToken } = await selected();
      arrange();
      const res = await verify({ ref: telegramRequestId });
      const data = await res.json();
      expect(data.status).toBe("failed");
      expect(data.reason).toBe(reason);
      expect(data.error).toBe(CHANNEL_FAILURE_MESSAGES[reason]);
      expect(await connectedRows()).toHaveLength(0);

      const after = (await getPendingByToken(correlationToken))!;
      expect(after.status).toBe("failed");
      expect(after.failureReason).toBe(reason);
      expect(after.resolvedUserId).toBeNull();
      // The user is also told in the bot chat — never that it connected.
      expect(String(userMessages().at(-1)!.body.text)).toContain(CHANNEL_FAILURE_MESSAGES[reason]);

      // Replaying Verify neither re-checks Telegram nor connects anything.
      const calls = sent.length;
      scenario = privateChannel(); // even if the problem was fixed meanwhile, this request is final
      expect((await (await verify({ ref: telegramRequestId })).json()).status).toBe("failed");
      expect(sent.length).toBe(calls);
      expect(await connectedRows()).toHaveLength(0);
    });
  }

  it("a channel already connected to another account is refused with the right explanation", async () => {
    const [other] = await db.insert(users).values({ telegramId: String(USER_B), referralCode: "E2EBOT02" }).onConflictDoUpdate({ target: users.telegramId, set: { updatedAt: new Date() } }).returning();
    await db.insert(channels).values({ userId: other.id, telegramChannelId: String(CHAT_ID), channelName: "Taken", status: "verified", isVerified: true, botIsAdmin: true });
    const { telegramRequestId, correlationToken } = await selected();
    const data = await (await verify({ ref: telegramRequestId })).json();
    expect(data).toMatchObject({ status: "failed", reason: "channel_already_connected" });
    expect((await getPendingByToken(correlationToken))?.status).toBe("failed");
    expect(String(userMessages().at(-1)!.body.text)).toContain(CHANNEL_FAILURE_MESSAGES.channel_already_connected);
    expect((await connectedRows()).every((r) => r.userId === other.id)).toBe(true);
    await db.delete(channels).where(eq(channels.telegramChannelId, String(CHAT_ID)));
    await db.delete(users).where(eq(users.id, other.id));
  });

  it("a legacy Direct Picker request is verified the same way (by token) — only after the user asks", async () => {
    const { telegramRequestId, correlationToken } = await newBotRequest("direct");
    await chatShared(USER_A, telegramRequestId);
    expect(await connectedRows()).toHaveLength(0);
    const data = await (await verify({ token: correlationToken })).json();
    expect(data.status).toBe("verified");
    expect(await connectedRows()).toHaveLength(1);
    expect(userMessages()).toHaveLength(0);
  });

  it("GET connect-status never verifies: polling a selected request leaves it unverified", async () => {
    const { telegramRequestId, correlationToken } = await selected();
    const { GET } = await import("@/app/api/channels/connect-status/route");
    const res = await GET(
      new NextRequest(`http://localhost/api/channels/connect-status?ref=${telegramRequestId}`, { headers: { host: "localhost", cookie: cookieFor(USER_A) } })
    );
    expect(await res.json()).toMatchObject({ status: "pending", stage: "channel_selected" });
    expect(sent).toHaveLength(0);
    expect(await connectedRows()).toHaveLength(0);
    expect((await getPendingByToken(correlationToken))?.claimed).toBe(false);
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
    // A brand-new chat first gets the unchanged creator welcome (not asserted here: earlier tests already recorded this
    // user's chat); either way the picker message is the Channel Selection message, never the welcome.
    expect(pickerMessage()!.body.text).not.toBe(BOT_WELCOME);
    const msg = pickerMessage()!.body;
    expect(msg.text).toBe(CHANNEL_SELECTION_MESSAGE);
    expect(String(msg.text)).not.toContain("Welcome to Onfile Channel Connection");
    expect(String(msg.text)).not.toMatch(/expire/i);
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

  it("without an https Mini App URL the Verify message is still sent (text only, no broken button) and the error is logged", async () => {
    delete process.env.MINI_APP_URL;
    for (const k of ["NEXT_PUBLIC_APP_URL", "VERCEL_PROJECT_PRODUCTION_URL", "VERCEL_URL", "VERCEL_ENV"]) delete process.env[k];
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { telegramRequestId } = await newBotRequest();
    await chatShared(USER_A, telegramRequestId);
    const note = userMessages().at(-1)!.body;
    expect(String(note.text)).toContain("Channel Verification");
    expect(note.reply_markup).toEqual({ remove_keyboard: true });
    expect(errSpy).toHaveBeenCalledWith("bot_connect_verify_button_unavailable", expect.objectContaining({ requiredEnv: "MINI_APP_URL" }));
  });
});
