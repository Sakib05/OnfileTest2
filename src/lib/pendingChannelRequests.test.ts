import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { channels, pendingChannelRequests, users } from "@/db/schema";
import {
  cancelPendingByToken,
  claimPendingRequestForProcessing,
  createPendingChannelRequest,
  getLatestPendingByTelegramUser,
  getPendingByTelegramRequest,
  getPendingByToken,
  updatePendingChannelRequestById,
} from "@/lib/pendingChannelRequests";
import type { ResolvedConnectingIdentity } from "@/lib/channelConnection";

const TEST_TG_USER_ID = 900_000_001;

function identity(telegramUserId = TEST_TG_USER_ID): ResolvedConnectingIdentity {
  return { telegramUserId, sessionUserId: null, telegramProfile: { username: "tester" } };
}

async function cleanup() {
  await db.delete(pendingChannelRequests).where(eq(pendingChannelRequests.telegramUserId, String(TEST_TG_USER_ID)));
}

beforeEach(cleanup);
afterAll(cleanup);

describe("pendingChannelRequests — durable correlation state (Bug 2)", () => {
  it("creates a pending request and can look it up by token and by (telegramUserId, requestId)", async () => {
    const created = await createPendingChannelRequest(identity());
    expect(created.correlationToken).toBeTruthy();
    expect(created.telegramRequestId).toBeGreaterThan(0);

    const byToken = await getPendingByToken(created.correlationToken);
    expect(byToken?.status).toBe("pending");
    expect(byToken?.identity.telegramUserId).toBe(TEST_TG_USER_ID);

    const byRequest = await getPendingByTelegramRequest(TEST_TG_USER_ID, created.telegramRequestId);
    expect(byRequest?.id).toBe(byToken?.id);
  });

  it("getLatestPendingByTelegramUser finds the most recently created pending request (used by the my_chat_member fallback path)", async () => {
    await createPendingChannelRequest(identity());
    await new Promise((r) => setTimeout(r, 5));
    const second = await createPendingChannelRequest(identity());

    const latest = await getLatestPendingByTelegramUser(TEST_TG_USER_ID);
    expect(latest?.telegramRequestId).toBe(second.telegramRequestId);
  });

  it("claimPendingRequestForProcessing only lets ONE caller win a race (prevents duplicate-update double-processing)", async () => {
    const created = await createPendingChannelRequest(identity());
    const pending = await getPendingByToken(created.correlationToken);
    expect(pending).toBeTruthy();

    const results = await Promise.all([
      claimPendingRequestForProcessing(pending!.id),
      claimPendingRequestForProcessing(pending!.id),
      claimPendingRequestForProcessing(pending!.id),
    ]);

    const winners = results.filter(Boolean);
    expect(winners.length).toBe(1);
  });

  it("a claimed request cannot be claimed again later (simulating chat_shared + my_chat_member both arriving)", async () => {
    const created = await createPendingChannelRequest(identity());
    const pending = await getPendingByToken(created.correlationToken);

    const first = await claimPendingRequestForProcessing(pending!.id);
    expect(first).toBe(true);

    const second = await claimPendingRequestForProcessing(pending!.id);
    expect(second).toBe(false);
  });

  it("cancelPendingByToken marks a pending request as failed/cancelled, and only once", async () => {
    const created = await createPendingChannelRequest(identity());
    const cancelled = await cancelPendingByToken(created.correlationToken);
    expect(cancelled).toBe(true);

    const row = await getPendingByToken(created.correlationToken);
    expect(row?.status).toBe("failed");
    expect(row?.failureReason).toBe("cancelled");

    // Already resolved — cancelling again is a documented no-op.
    const cancelledAgain = await cancelPendingByToken(created.correlationToken);
    expect(cancelledAgain).toBe(false);
  });

  it("a verified/failed request is excluded from getLatestPendingByTelegramUser", async () => {
    const created = await createPendingChannelRequest(identity());
    const pending = await getPendingByToken(created.correlationToken);
    await updatePendingChannelRequestById(pending!.id, { status: "verified" });

    const latest = await getLatestPendingByTelegramUser(TEST_TG_USER_ID);
    expect(latest).toBeUndefined();
  });

  it("an expired request is treated as missing", async () => {
    const created = await createPendingChannelRequest(identity());
    await db
      .update(pendingChannelRequests)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(pendingChannelRequests.telegramUserId, String(TEST_TG_USER_ID)));

    const byToken = await getPendingByToken(created.correlationToken);
    expect(byToken).toBeUndefined();

    const latest = await getLatestPendingByTelegramUser(TEST_TG_USER_ID);
    expect(latest).toBeUndefined();
  });

  it("a mismatched telegram user id never resolves another user's request", async () => {
    const created = await createPendingChannelRequest(identity());
    const wrongUser = await getPendingByTelegramRequest(TEST_TG_USER_ID + 1, created.telegramRequestId);
    expect(wrongUser).toBeUndefined();
  });
});

// Keep test data out of unrelated tables (defensive cleanup only; these
// tests never create real users/channels).
afterAll(async () => {
  await db.delete(channels).where(eq(channels.channelName, "__pending_requests_test__"));
  await db.delete(users).where(eq(users.telegramId, String(TEST_TG_USER_ID)));
});
