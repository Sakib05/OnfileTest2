import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { channels, pendingChannelRequests, users } from "@/db/schema";

/**
 * Unit tests of the Mini App's server-side verification (verifyPendingChannelRequest) with the Telegram live
 * check replaced by a controllable double, real Postgres otherwise. The Telegram-facing behaviour (privacy,
 * admin rights, bot permissions) is covered end to end in botFallback.e2e.test.ts.
 */
const tg = vi.hoisted(() => ({
  verify: vi.fn(),
}));
vi.mock("@/lib/telegramBot", async (orig) => ({
  ...(await orig<typeof import("@/lib/telegramBot")>()),
  verifyChannelOwnershipAndBotAccess: tg.verify,
}));
vi.mock("@/lib/botConnectFlow", async (orig) => ({
  ...(await orig<typeof import("@/lib/botConnectFlow")>()),
  notifyBotConnectionFailure: vi.fn(async () => {}),
}));

import { verifyPendingChannelRequest } from "@/lib/connectVerification";
import {
  beginBotConnect,
  createPendingChannelRequest,
  getRequestByToken,
  recordChannelSelection,
} from "@/lib/pendingChannelRequests";

const USER = 900_950_001;
const CHAT = "-1009500000001";
let accountId: number;

const okVerification = () => ({
  ok: true as const,
  chat: { id: CHAT, type: "channel", title: "Unit Channel" },
});

async function selectedRequest() {
  const created = await createPendingChannelRequest({ telegramUserId: USER, sessionUserId: accountId, telegramProfile: null }, { method: "bot" });
  const row = (await getRequestByToken(created.correlationToken))!;
  await beginBotConnect(row.id);
  await recordChannelSelection(USER, created.telegramRequestId, CHAT);
  return { ...created, load: async () => (await getRequestByToken(created.correlationToken))! };
}
const channelRows = () => db.select().from(channels).where(eq(channels.telegramChannelId, CHAT));

async function cleanup() {
  await db.delete(channels).where(eq(channels.telegramChannelId, CHAT));
  await db.delete(pendingChannelRequests).where(eq(pendingChannelRequests.telegramUserId, String(USER)));
}

beforeEach(async () => {
  tg.verify.mockReset();
  await cleanup();
  const [u] = await db
    .insert(users)
    .values({ telegramId: String(USER), referralCode: "UNITVER1" })
    .onConflictDoUpdate({ target: users.telegramId, set: { updatedAt: new Date() } })
    .returning();
  accountId = u.id;
});
afterAll(async () => {
  await cleanup();
  await db.delete(users).where(eq(users.telegramId, String(USER)));
});

describe("verifyPendingChannelRequest", () => {
  it("verifies the STORED channel for the request's Telegram user, then connects it exactly once", async () => {
    tg.verify.mockResolvedValue(okVerification());
    const req = await selectedRequest();
    const result = await verifyPendingChannelRequest(await req.load(), "ua");
    expect(result).toEqual({ kind: "verified" });
    expect(tg.verify).toHaveBeenCalledTimes(1);
    expect(tg.verify).toHaveBeenCalledWith(CHAT, USER);
    expect(await channelRows()).toHaveLength(1);
    expect((await req.load()).status).toBe("verified");

    // A replay only reports the resolved state: no second Telegram check, no second connection.
    expect(await verifyPendingChannelRequest(await req.load(), "ua")).toEqual({ kind: "already_resolved" });
    expect(tg.verify).toHaveBeenCalledTimes(1);
    expect(await channelRows()).toHaveLength(1);
  });

  it("never verifies or connects without a stored selection", async () => {
    const created = await createPendingChannelRequest({ telegramUserId: USER, sessionUserId: accountId, telegramProfile: null }, { method: "bot" });
    const row = (await getRequestByToken(created.correlationToken))!;
    await beginBotConnect(row.id);
    expect(await verifyPendingChannelRequest((await getRequestByToken(created.correlationToken))!, "ua")).toEqual({ kind: "awaiting_selection" });
    expect(tg.verify).not.toHaveBeenCalled();
    expect(await channelRows()).toHaveLength(0);
  });

  it("a request that was not started by Connect is not verifiable", async () => {
    const created = await createPendingChannelRequest({ telegramUserId: USER, sessionUserId: accountId, telegramProfile: null }, { method: "bot" });
    expect(await verifyPendingChannelRequest((await getRequestByToken(created.correlationToken))!, "ua")).toEqual({ kind: "awaiting_selection" });
    expect(tg.verify).not.toHaveBeenCalled();
  });

  it("an expired request is rejected without any Telegram call", async () => {
    const req = await selectedRequest();
    await db.update(pendingChannelRequests).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(pendingChannelRequests.telegramRequestId, req.telegramRequestId));
    expect(await verifyPendingChannelRequest(await req.load(), "ua")).toEqual({ kind: "expired" });
    expect(tg.verify).not.toHaveBeenCalled();
    expect(await channelRows()).toHaveLength(0);
  });

  it("a failed verification is final: request 'failed', nothing connected, never re-verified", async () => {
    tg.verify.mockResolvedValue({ ok: false, reason: "bot_missing_permissions" });
    const req = await selectedRequest();
    expect(await verifyPendingChannelRequest(await req.load(), "ua")).toEqual({ kind: "failed", reason: "bot_missing_permissions" });
    const after = await req.load();
    expect(after.status).toBe("failed");
    expect(after.failureReason).toBe("bot_missing_permissions");
    expect(await channelRows()).toHaveLength(0);

    tg.verify.mockResolvedValue(okVerification()); // even if the problem is fixed, THIS request stays failed
    expect(await verifyPendingChannelRequest(await req.load(), "ua")).toEqual({ kind: "already_resolved" });
    expect(tg.verify).toHaveBeenCalledTimes(1);
    expect(await channelRows()).toHaveLength(0);
  });

  it("a Telegram outage is retryable: the claim is released, nothing is decided or connected, and a later tap succeeds", async () => {
    tg.verify.mockResolvedValueOnce({ ok: false, reason: "telegram_api_error" });
    const req = await selectedRequest();
    expect(await verifyPendingChannelRequest(await req.load(), "ua")).toEqual({ kind: "retryable", reason: "telegram_api_error" });
    const mid = await req.load();
    expect(mid).toMatchObject({ status: "pending", claimed: false, lifecycle: "channel_selected" });
    expect(await channelRows()).toHaveLength(0);

    tg.verify.mockResolvedValueOnce(okVerification());
    expect(await verifyPendingChannelRequest(await req.load(), "ua")).toEqual({ kind: "verified" });
    expect(await channelRows()).toHaveLength(1);
  });

  it("concurrent calls: exactly one performs the verification and the connection", async () => {
    tg.verify.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 30));
      return okVerification();
    });
    const req = await selectedRequest();
    const snapshot = await req.load();
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => verifyPendingChannelRequest(snapshot, "ua")));
    expect(results.filter((r) => r.kind === "verified")).toHaveLength(1);
    for (const r of results) expect(["verified", "verifying"]).toContain(r.kind);
    expect(tg.verify).toHaveBeenCalledTimes(1);
    expect(await channelRows()).toHaveLength(1);
  });

  it("a channel already connected to another account is a final 'channel_already_connected' failure", async () => {
    const [other] = await db.insert(users).values({ telegramId: String(USER + 1), referralCode: "UNITVER2" }).onConflictDoUpdate({ target: users.telegramId, set: { updatedAt: new Date() } }).returning();
    await db.insert(channels).values({ userId: other.id, telegramChannelId: CHAT, channelName: "Taken", status: "verified", isVerified: true, botIsAdmin: true });
    tg.verify.mockResolvedValue(okVerification());
    const req = await selectedRequest();
    expect(await verifyPendingChannelRequest(await req.load(), "ua")).toEqual({ kind: "failed", reason: "channel_already_connected" });
    expect((await req.load()).status).toBe("failed");
    expect((await channelRows()).every((r) => r.userId === other.id)).toBe(true);
    await db.delete(channels).where(eq(channels.telegramChannelId, CHAT));
    await db.delete(users).where(eq(users.id, other.id));
  });
});
