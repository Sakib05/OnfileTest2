import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { pendingChannelRequests } from "@/db/schema";
import { POST } from "./route";
import { createSetupToken, SETUP_COOKIE_NAME } from "@/lib/setupToken";
import { connectMethodForRequestId, getRequestByToken } from "@/lib/pendingChannelRequests";

const TG_USER = 900_300_001;
const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
let ip = 0;

function req(opts: { cookie?: string; origin?: string } = {}) {
  return new NextRequest("http://localhost/api/channels/connect-bot-request", {
    method: "POST",
    headers: {
      host: "localhost",
      "x-forwarded-for": `10.30.0.${++ip}`,
      ...(opts.cookie ? { cookie: `${SETUP_COOKIE_NAME}=${opts.cookie}` } : {}),
      ...(opts.origin ? { origin: opts.origin } : {}),
    },
  });
}

const setupCookie = () => createSetupToken({ id: TG_USER, first_name: "Tester" });

async function cleanup() {
  await db.delete(pendingChannelRequests).where(eq(pendingChannelRequests.telegramUserId, String(TG_USER)));
}

beforeEach(async () => {
  process.env.TELEGRAM_BOT_TOKEN = "test-token-connect-bot-request";
  global.fetch = vi.fn(async (url: string) => {
    const method = String(url).split("/").pop();
    const result = method === "getMe" ? { id: 555, username: "ConfiguredOnfileBot" } : true;
    return new Response(JSON.stringify({ ok: true, result }), { status: 200 });
  }) as unknown as typeof fetch;
  await cleanup();
});
afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  process.env.TELEGRAM_BOT_TOKEN = ORIGINAL_TOKEN;
});
afterAll(cleanup);

describe("POST /api/channels/connect-bot-request", () => {
  it("401 without a session or setup cookie — no pending request is created", async () => {
    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(await db.select().from(pendingChannelRequests).where(eq(pendingChannelRequests.telegramUserId, String(TG_USER)))).toHaveLength(0);
  });

  it("403 for a cross-origin request", async () => {
    const res = await POST(req({ cookie: setupCookie(), origin: "https://evil.example" }));
    expect(res.status).toBe(403);
  });

  it("503 when the bot token is not configured", async () => {
    const cookie = setupCookie();
    delete process.env.TELEGRAM_BOT_TOKEN;
    const res = await POST(req({ cookie }));
    expect(res.status).toBe(503);
  });

  it("Start creates a 'prepared' request bound to the authenticated Telegram user — and sends NOTHING to Telegram", async () => {
    const calls: string[] = [];
    global.fetch = vi.fn(async (url: string) => {
      const method = String(url).split("/").pop() as string;
      calls.push(method);
      const result = method === "getMe" ? { id: 555, username: "ConfiguredOnfileBot" } : true;
      return new Response(JSON.stringify({ ok: true, result }), { status: 200 });
    }) as unknown as typeof fetch;

    const res = await POST(req({ cookie: setupCookie() }));
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.state).toBe("prepared");
    expect(data.botUsername).toBe("ConfiguredOnfileBot");
    expect(typeof data.token).toBe("string");
    expect(data.botUrl).toBeUndefined(); // navigation data only exists after "Connect"
    expect(calls).not.toContain("sendMessage");

    const pending = await getRequestByToken(data.token);
    expect(pending?.lifecycle).toBe("prepared");
    expect(pending?.status).toBe("pending");
    expect(pending?.identity.telegramUserId).toBe(TG_USER);
    expect(connectMethodForRequestId(pending!.telegramRequestId)).toBe("bot");
    expect(data.ref).toBe(pending!.telegramRequestId);
    // Countdown has not started; the row only stores the SHA-256 of the token, never the token.
    expect(pending?.connectStartedAt).toBeNull();
    const [row] = await db.select().from(pendingChannelRequests).where(eq(pendingChannelRequests.id, pending!.id));
    expect(row.tokenHash).not.toBe(data.token);
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    // Cryptographically random, unguessable token (24 random bytes → 32 base64url chars).
    expect(data.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(pending!.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(10 * 60 * 1000);
  });

  it("ignores any Telegram / chat / channel id the browser sends in the body or query", async () => {
    const r = new NextRequest("http://localhost/api/channels/connect-bot-request?telegramUserId=1&chatId=2", {
      method: "POST",
      headers: { host: "localhost", "x-forwarded-for": `10.30.1.${++ip}`, "content-type": "application/json", cookie: `${SETUP_COOKIE_NAME}=${setupCookie()}` },
      body: JSON.stringify({ telegramUserId: 42, chatId: 43, channelId: -100123 }),
    });
    const data = await (await POST(r)).json();
    expect((await getRequestByToken(data.token))?.identity.telegramUserId).toBe(TG_USER);
  });

  it("duplicate Start: each call creates a distinct request; the newest supersedes the earlier one (state 'cancelled')", async () => {
    const a = await (await POST(req({ cookie: setupCookie() }))).json();
    const b = await (await POST(req({ cookie: setupCookie() }))).json();
    expect(a.token).not.toBe(b.token);
    expect(a.ref).not.toBe(b.ref);
    expect((await getRequestByToken(a.token))?.lifecycle).toBe("cancelled");
    expect((await getRequestByToken(b.token))?.lifecycle).toBe("prepared");
  });
});
