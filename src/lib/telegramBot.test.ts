import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkChannelPostExists,
  classifyPostProbeError,
  normalizeChannelIdentifier,
  REQUIRED_BOT_ADMIN_RIGHTS,
  REQUIRED_USER_ADMIN_RIGHTS,
  verifyChannelOwnershipAndBotAccess,
} from "@/lib/telegramBot";

const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

function mockTelegramApi(handlers: Record<string, (body: unknown) => unknown>) {
  global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const method = String(url).split("/").pop();
    const body = init?.body ? JSON.parse(init.body as string) : {};
    const handler = method ? handlers[method] : undefined;
    if (!handler) {
      return new Response(JSON.stringify({ ok: false, description: `no handler for ${method}` }), { status: 404 });
    }
    const result = handler(body);
    return new Response(JSON.stringify({ ok: true, result }), { status: 200 });
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  process.env.TELEGRAM_BOT_TOKEN = "test-token";
});

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  process.env.TELEGRAM_BOT_TOKEN = ORIGINAL_TOKEN;
  vi.restoreAllMocks();
});

describe("normalizeChannelIdentifier (legacy public-identifier path)", () => {
  it("normalizes a public t.me link to @username", () => {
    expect(normalizeChannelIdentifier("https://t.me/mychannel")).toBe("@mychannel");
  });

  it("normalizes a bare username", () => {
    expect(normalizeChannelIdentifier("mychannel")).toBe("@mychannel");
  });

  it("passes through a numeric chat id", () => {
    expect(normalizeChannelIdentifier("-1001234567890")).toBe("-1001234567890");
  });

  it("rejects a private invite link (not its job — see src/lib/inviteLink.ts)", () => {
    expect(normalizeChannelIdentifier("https://t.me/+AbCdEfGhIjKlMnOp")).toBeNull();
  });

  it("rejects empty input", () => {
    expect(normalizeChannelIdentifier("")).toBeNull();
  });
});

describe("REQUIRED_BOT_ADMIN_RIGHTS / REQUIRED_USER_ADMIN_RIGHTS", () => {
  it("only requests can_post_messages — nothing else", () => {
    expect(REQUIRED_BOT_ADMIN_RIGHTS.can_post_messages).toBe(true);
    const otherRights = Object.entries(REQUIRED_BOT_ADMIN_RIGHTS).filter(([key]) => key !== "can_post_messages");
    for (const [, value] of otherRights) {
      expect(value).toBe(false);
    }
  });

  it("user rights are a superset of (here, identical to) bot rights, satisfying Telegram's USER_RIGHTS_MISSING constraint", () => {
    expect(REQUIRED_USER_ADMIN_RIGHTS).toEqual(REQUIRED_BOT_ADMIN_RIGHTS);
  });
});

describe("verifyChannelOwnershipAndBotAccess — live Telegram re-verification", () => {
  it("rejects a channel with a public username (never a fake success)", async () => {
    mockTelegramApi({
      getChat: () => ({ id: -1001111111111, type: "channel", title: "Public", username: "publicchannel" }),
    });
    const result = await verifyChannelOwnershipAndBotAccess("@publicchannel", 12345);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("channel_is_public");
  });

  it("rejects when the bot is not an admin", async () => {
    mockTelegramApi({
      getChat: () => ({ id: -1001111111112, type: "channel", title: "Private" }),
      getMe: () => ({ id: 999, username: "onfile_bot" }),
      getChatMember: (body) => {
        const b = body as { user_id: number };
        if (b.user_id === 999) return { status: "member", user: { id: 999 } };
        return { status: "administrator", user: { id: b.user_id } };
      },
    });
    const result = await verifyChannelOwnershipAndBotAccess("-1001111111112", 12345);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("bot_not_admin");
  });

  it("rejects when the requesting user is not an admin/creator", async () => {
    mockTelegramApi({
      getChat: () => ({ id: -1001111111113, type: "channel", title: "Private" }),
      getMe: () => ({ id: 999, username: "onfile_bot" }),
      getChatMember: (body) => {
        const b = body as { user_id: number };
        if (b.user_id === 999) return { status: "administrator", user: { id: 999 }, can_post_messages: true };
        return { status: "member", user: { id: b.user_id } };
      },
    });
    const result = await verifyChannelOwnershipAndBotAccess("-1001111111113", 12345);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("user_not_admin");
  });

  it("succeeds when the channel is private, the bot is admin with post rights, and the user is an admin", async () => {
    mockTelegramApi({
      getChat: () => ({ id: -1001111111114, type: "channel", title: "My Private Channel" }),
      getMe: () => ({ id: 999, username: "onfile_bot" }),
      getChatMember: (body) => {
        const b = body as { user_id: number };
        if (b.user_id === 999) return { status: "administrator", user: { id: 999 }, can_post_messages: true };
        return { status: "creator", user: { id: b.user_id } };
      },
    });
    const result = await verifyChannelOwnershipAndBotAccess("-1001111111114", 12345);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.chat.id).toBe("-1001111111114");
      expect(result.chat.username).toBeUndefined();
    }
  });

  it("rejects a non-channel chat (group)", async () => {
    mockTelegramApi({
      getChat: () => ({ id: -100222, type: "group", title: "A group" }),
    });
    const result = await verifyChannelOwnershipAndBotAccess("-100222", 12345);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("not_a_channel");
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// checkChannelPostExists — Bot API request/response handling.
// SIMULATED: `fetch` is replaced by a fake Telegram that answers like the documented
// copyMessage / deleteMessage responses. This proves our request shape and the
// fail-closed mapping; it is NOT proof that a real Telegram post exists.
// ─────────────────────────────────────────────────────────────────────────────
describe("checkChannelPostExists — simulated Telegram Bot API", () => {
  type Call = { method: string; body: Record<string, unknown> };
  let calls: Call[];

  /** Fake Telegram: the channel contains message ids 1..15 only. */
  function fakeTelegram(opts: { existing?: number; copyError?: { code: number; description: string } | "timeout" | "non-json" | "no-id"; getChat?: "ok" | "not_found" } = {}) {
    const existing = opts.existing ?? 15;
    calls = [];
    global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const method = String(url).split("/").pop()!;
      const body = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {};
      calls.push({ method, body });
      const err = (code: number, description: string) =>
        new Response(JSON.stringify({ ok: false, error_code: code, description }), { status: code });
      if (method === "copyMessage") {
        const e = opts.copyError;
        if (e === "timeout") {
          const abort = new Error("aborted");
          abort.name = "AbortError";
          throw abort;
        }
        if (e === "non-json") return new Response("<html>Bad gateway</html>", { status: 502 });
        if (e === "no-id") return new Response(JSON.stringify({ ok: true, result: true }), { status: 200 });
        if (e) return err(e.code, e.description);
        const id = body.message_id as number;
        if (id < 1 || id > existing) return err(400, "Bad Request: message to copy not found");
        return new Response(JSON.stringify({ ok: true, result: { message_id: 9000 + id } }), { status: 200 });
      }
      if (method === "deleteMessage") return new Response(JSON.stringify({ ok: true, result: true }), { status: 200 });
      if (method === "getChat") {
        return opts.getChat === "not_found"
          ? err(400, "Bad Request: chat not found")
          : new Response(JSON.stringify({ ok: true, result: { id: 5550001, type: "private" } }), { status: 200 });
      }
      return err(404, "Not Found");
    }) as unknown as typeof fetch;
  }

  const args = (messageId: number) => ({ chatId: "-1004447210820", messageId, probeChatId: "5550001" });

  it("existing post #15 → ok; copies THAT exact id to the creator's private chat (never the channel), silently, then deletes the copy", async () => {
    fakeTelegram();
    expect(await checkChannelPostExists(args(15))).toEqual({ ok: true });
    expect(calls[0]).toMatchObject({
      method: "copyMessage",
      body: { chat_id: 5550001, from_chat_id: "-1004447210820", message_id: 15, disable_notification: true, protect_content: true },
    });
    expect(calls[1]).toMatchObject({ method: "deleteMessage", body: { chat_id: 5550001, message_id: 9015 } });
    // nothing is ever sent TO the channel
    expect(calls.some((c) => c.body.chat_id === "-1004447210820")).toBe(false);
  });

  it("non-existent post #152 → post_not_found, nothing to clean up", async () => {
    fakeTelegram();
    expect(await checkChannelPostExists(args(152))).toMatchObject({ ok: false, reason: "post_not_found" });
    expect(calls.map((c) => c.method)).toEqual(["copyMessage"]);
  });

  it("MESSAGE_ID_INVALID is also post_not_found", async () => {
    fakeTelegram({ copyError: { code: 400, description: "Bad Request: MESSAGE_ID_INVALID" } });
    expect(await checkChannelPostExists(args(15))).toMatchObject({ ok: false, reason: "post_not_found" });
  });

  it("timeout → unavailable (never ok)", async () => {
    fakeTelegram({ copyError: "timeout" });
    expect(await checkChannelPostExists(args(15))).toMatchObject({ ok: false, reason: "unavailable" });
  });

  it("non-JSON / 5xx gateway answer → unavailable", async () => {
    fakeTelegram({ copyError: "non-json" });
    expect(await checkChannelPostExists(args(15))).toMatchObject({ ok: false, reason: "unavailable" });
  });

  it("ok:true without a MessageId (unsupported response) → unavailable", async () => {
    fakeTelegram({ copyError: "no-id" });
    expect(await checkChannelPostExists(args(15))).toMatchObject({ ok: false, reason: "unavailable" });
  });

  it("429 rate limit → unavailable", async () => {
    fakeTelegram({ copyError: { code: 429, description: "Too Many Requests: retry after 5" } });
    expect(await checkChannelPostExists(args(15))).toMatchObject({ ok: false, reason: "unavailable" });
  });

  it("bot permission failures → bot_no_access", async () => {
    for (const description of ["Forbidden: bot is not a member of the channel chat", "Bad Request: not enough rights to access the message", "Forbidden: bot was kicked from the channel chat"]) {
      fakeTelegram({ copyError: { code: description.startsWith("Forbidden") ? 403 : 400, description } });
      expect(await checkChannelPostExists(args(15))).toMatchObject({ ok: false, reason: "bot_no_access" });
    }
  });

  it("creator never pressed Start / blocked the bot → probe_chat_unavailable", async () => {
    fakeTelegram({ copyError: { code: 403, description: "Forbidden: bot can't initiate conversation with a user" } });
    expect(await checkChannelPostExists(args(15))).toMatchObject({ ok: false, reason: "probe_chat_unavailable" });
    fakeTelegram({ copyError: { code: 403, description: "Forbidden: bot was blocked by the user" } });
    expect(await checkChannelPostExists(args(15))).toMatchObject({ ok: false, reason: "probe_chat_unavailable" });
  });

  it("'chat not found' is disambiguated with getChat on the private chat", async () => {
    fakeTelegram({ copyError: { code: 400, description: "Bad Request: chat not found" }, getChat: "ok" });
    expect(await checkChannelPostExists(args(15))).toMatchObject({ ok: false, reason: "bot_no_access" });
    fakeTelegram({ copyError: { code: 400, description: "Bad Request: chat not found" }, getChat: "not_found" });
    expect(await checkChannelPostExists(args(15))).toMatchObject({ ok: false, reason: "probe_chat_unavailable" });
  });

  it("service messages / protected content → post_not_copyable", async () => {
    fakeTelegram({ copyError: { code: 400, description: "Bad Request: message can't be copied" } });
    expect(await checkChannelPostExists(args(15))).toMatchObject({ ok: false, reason: "post_not_copyable" });
    fakeTelegram({ copyError: { code: 400, description: "Bad Request: CHAT_FORWARDS_RESTRICTED" } });
    expect(await checkChannelPostExists(args(15))).toMatchObject({ ok: false, reason: "post_not_copyable" });
  });

  it("missing bot token / no telegram user / malformed ids → rejected without calling Telegram", async () => {
    fakeTelegram();
    expect(await checkChannelPostExists({ ...args(15), probeChatId: null })).toMatchObject({ ok: false, reason: "probe_chat_unavailable" });
    expect(await checkChannelPostExists({ ...args(15), chatId: "-100abc" })).toMatchObject({ ok: false, reason: "unavailable" });
    expect(await checkChannelPostExists(args(0))).toMatchObject({ ok: false, reason: "post_not_found" });
    delete process.env.TELEGRAM_BOT_TOKEN;
    expect(await checkChannelPostExists(args(15))).toMatchObject({ ok: false, reason: "unavailable" });
    expect(calls).toHaveLength(0);
  });

  it("a failed cleanup deleteMessage does not change the verdict", async () => {
    fakeTelegram();
    const inner = global.fetch;
    global.fetch = vi.fn(async (url: string, init?: RequestInit) =>
      String(url).endsWith("/deleteMessage")
        ? new Response(JSON.stringify({ ok: false, error_code: 400, description: "Bad Request: message can't be deleted" }), { status: 400 })
        : inner(url, init)
    ) as unknown as typeof fetch;
    expect(await checkChannelPostExists(args(15))).toEqual({ ok: true });
  });

  it("identical concurrent probes share ONE copyMessage call (no duplicate messages)", async () => {
    fakeTelegram();
    const [a, b, c] = await Promise.all([checkChannelPostExists(args(15)), checkChannelPostExists(args(15)), checkChannelPostExists(args(15))]);
    expect([a.ok, b.ok, c.ok]).toEqual([true, true, true]);
    expect(calls.filter((x) => x.method === "copyMessage")).toHaveLength(1);
  });
});

describe("classifyPostProbeError — only documented 'no such message' answers mean 'not found'", () => {
  it("never maps unknown errors to a verdict about the post", () => {
    expect(classifyPostProbeError(500, "Internal Server Error")).toBe("unavailable");
    expect(classifyPostProbeError(401, "Unauthorized")).toBe("unavailable");
    expect(classifyPostProbeError(undefined, "request_timed_out")).toBe("unavailable");
    expect(classifyPostProbeError(undefined, "non_json_response")).toBe("unavailable");
    expect(classifyPostProbeError(400, "Bad Request: message to copy not found")).toBe("post_not_found");
  });
});
