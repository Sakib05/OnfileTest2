import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { channels, pendingChannelRequests, users } from "@/db/schema";
import { GET } from "./route";
import { createSetupToken, SETUP_COOKIE_NAME } from "@/lib/setupToken";
import { claimPendingRequestForProcessing, createPendingChannelRequest, getPendingByToken, updatePendingChannelRequestById } from "@/lib/pendingChannelRequests";

/** GET /api/channels/connect-status — the "check status" endpoint. Real Postgres, no Telegram calls. */

const USER_A = 900_700_001;
const USER_B = 900_700_002;
const CHANNEL_ID = "-1009700000001";
let accountA: number;
const ORIGINAL_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

beforeAll(() => {
  // Only used to sign the test setup cookie; no Telegram call is made by this route.
  process.env.TELEGRAM_BOT_TOKEN = "test-token-connect-status";
});

const cookieFor = (id: number) => `${SETUP_COOKIE_NAME}=${createSetupToken({ id, first_name: "T" })}`;
function get(token: string | null, asUser: number | null) {
  return GET(
    new NextRequest(`http://localhost/api/channels/connect-status${token === null ? "" : `?token=${encodeURIComponent(token)}`}`, {
      headers: { host: "localhost", ...(asUser ? { cookie: cookieFor(asUser) } : {}) },
    })
  );
}
const newPending = (method: "bot" | "direct" = "bot") =>
  createPendingChannelRequest({ telegramUserId: USER_A, sessionUserId: accountA, telegramProfile: null }, { method });

async function cleanup() {
  await db.delete(channels).where(eq(channels.telegramChannelId, CHANNEL_ID));
  await db.delete(pendingChannelRequests).where(inArray(pendingChannelRequests.telegramUserId, [String(USER_A), String(USER_B)]));
}

beforeEach(async () => {
  await cleanup();
  const [u] = await db
    .insert(users)
    .values({ telegramId: String(USER_A), referralCode: "E2ESTAT1" })
    .onConflictDoUpdate({ target: users.telegramId, set: { updatedAt: new Date() } })
    .returning();
  accountA = u.id;
});
afterAll(async () => {
  process.env.TELEGRAM_BOT_TOKEN = ORIGINAL_TOKEN;
  await cleanup();
  await db.delete(users).where(eq(users.telegramId, String(USER_A)));
});

describe("GET /api/channels/connect-status", () => {
  it("400 without a token", async () => {
    expect((await get(null, USER_A)).status).toBe(400);
  });

  it("404 expired for an unknown token", async () => {
    const res = await get("nope", USER_A);
    expect(res.status).toBe(404);
    expect((await res.json()).status).toBe("expired");
  });

  it("pending: awaiting selection, then verifying once claimed", async () => {
    const { correlationToken } = await newPending();
    expect(await (await get(correlationToken, USER_A)).json()).toEqual({ status: "pending", stage: "awaiting_selection" });
    const pending = (await getPendingByToken(correlationToken))!;
    await claimPendingRequestForProcessing(pending.id);
    expect(await (await get(correlationToken, USER_A)).json()).toEqual({ status: "pending", stage: "verifying" });
  });

  it("verified: returns the connected channel (only after the server recorded the verified connection)", async () => {
    const { correlationToken } = await newPending();
    const [channel] = await db
      .insert(channels)
      .values({ userId: accountA, telegramChannelId: CHANNEL_ID, channelName: "Priv", status: "verified", isVerified: true, botIsAdmin: true })
      .returning();
    const pending = (await getPendingByToken(correlationToken))!;
    await updatePendingChannelRequestById(pending.id, { status: "verified", resolvedChannelId: channel.id, resolvedUserId: accountA });
    const res = await get(correlationToken, USER_A);
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.status).toBe("verified");
    expect(data.channel).toMatchObject({ id: channel.id, channelName: "Priv", status: "verified" });
  });

  it("failed: returns the specific reason and message", async () => {
    const { correlationToken } = await newPending();
    const pending = (await getPendingByToken(correlationToken))!;
    await updatePendingChannelRequestById(pending.id, { status: "failed", failureReason: "channel_is_public" });
    const data = await (await get(correlationToken, USER_A)).json();
    expect(data.status).toBe("failed");
    expect(data.reason).toBe("channel_is_public");
    expect(typeof data.error).toBe("string");
  });

  it("expired (past expires_at) behaves like a missing request", async () => {
    const { correlationToken } = await newPending();
    const pending = (await getPendingByToken(correlationToken))!;
    await db.update(pendingChannelRequests).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(pendingChannelRequests.id, pending.id));
    const res = await get(correlationToken, USER_A);
    expect(res.status).toBe(404);
    expect((await res.json()).status).toBe("expired");
  });

  it("another Telegram user's valid token is indistinguishable from an unknown one", async () => {
    const { correlationToken } = await newPending();
    const res = await get(correlationToken, USER_B);
    expect(res.status).toBe(404);
    expect((await res.json()).status).toBe("expired");
  });

  it("401 unauthorized when the caller is not signed in — the status of the request is not revealed", async () => {
    const { correlationToken } = await newPending();
    const res = await get(correlationToken, null);
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.status).toBe("unauthorized");
    expect(data.channel).toBeUndefined();
  });
});
