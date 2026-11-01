import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
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
