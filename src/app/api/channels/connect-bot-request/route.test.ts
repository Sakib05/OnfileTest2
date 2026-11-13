import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { pendingChannelRequests } from "@/db/schema";
import { POST } from "./route";
import { createSetupToken, SETUP_COOKIE_NAME } from "@/lib/setupToken";
import { verifyBotStartPayload } from "@/lib/botConnectFlow";
import { connectMethodForRequestId, getPendingByToken } from "@/lib/pendingChannelRequests";

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

  it("returns a deep link to the CONFIGURED bot with a payload bound to the authenticated user", async () => {
    const res = await POST(req({ cookie: setupCookie() }));
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.botUrl).toMatch(/^https:\/\/t\.me\/ConfiguredOnfileBot\?start=c1_[0-9a-z]+_[0-9a-f]{24}$/);
    expect(data.botUrl).not.toContain("test-token-connect-bot-request");

    const payload = new URL(data.botUrl).searchParams.get("start")!;
    const verified = verifyBotStartPayload(payload, TG_USER);
    expect(verified.ok).toBe(true);
    // Not valid for any other Telegram user.
    expect(verifyBotStartPayload(payload, TG_USER + 1).ok).toBe(false);

    // The pending request exists, is pending, belongs to this user, uses the bot range,
    // and the payload references exactly that request.
    const pending = await getPendingByToken(data.token);
    expect(pending?.status).toBe("pending");
    expect(pending?.identity.telegramUserId).toBe(TG_USER);
    expect(connectMethodForRequestId(pending!.telegramRequestId)).toBe("bot");
    expect(verified.ok && verified.requestId).toBe(pending!.telegramRequestId);
    // Short-lived: at most the 10 minute TTL.
    expect(pending!.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(10 * 60 * 1000);
  });

  it("each call creates a distinct request; the newest supersedes the earlier one (no duplicate live requests)", async () => {
    const a = await (await POST(req({ cookie: setupCookie() }))).json();
    const b = await (await POST(req({ cookie: setupCookie() }))).json();
    expect(a.token).not.toBe(b.token);
    expect(a.botUrl).not.toBe(b.botUrl);
    expect((await getPendingByToken(a.token))?.status).toBe("failed");
    expect((await getPendingByToken(b.token))?.status).toBe("pending");
  });
});
