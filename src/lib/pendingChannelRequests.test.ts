import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { channels, pendingChannelRequests, users } from "@/db/schema";
import {
  beginBotConnect,
  cancelPendingByToken,
  claimConfirmationDelivery,
  claimPendingRequestForProcessing,
  claimPickerDelivery,
  CONNECT_WINDOW_MS,
  createPendingChannelRequest,
  deriveLifecycleState,
  getLatestPendingByTelegramUser,
  getPendingByTelegramRequest,
  getPendingByToken,
  getRequestByRef,
  getRequestByToken,
  releasePickerDelivery,
  revertBotConnectStart,
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

// ─── Bot-guided lifecycle ────────────────────────────────────────────────────

describe("deriveLifecycleState", () => {
  const base = { status: "pending" as const, failureReason: null, claimedAt: null, connectStartedAt: null, pickerSentAt: null, expiresAt: new Date(Date.now() + 60_000) };
  const now = new Date();
  it("maps every stored combination to exactly one lifecycle state", () => {
    expect(deriveLifecycleState(base, now)).toBe("prepared");
    expect(deriveLifecycleState({ ...base, connectStartedAt: new Date() }, now)).toBe("connecting");
    expect(deriveLifecycleState({ ...base, connectStartedAt: new Date(), pickerSentAt: new Date() }, now)).toBe("awaiting_channel_selection");
    expect(deriveLifecycleState({ ...base, connectStartedAt: new Date(), pickerSentAt: new Date(), claimedAt: new Date() }, now)).toBe("verifying");
    expect(deriveLifecycleState({ ...base, status: "verified" }, now)).toBe("connected");
    expect(deriveLifecycleState({ ...base, status: "failed", failureReason: "bot_not_admin" }, now)).toBe("failed");
    expect(deriveLifecycleState({ ...base, status: "failed", failureReason: "cancelled" }, now)).toBe("cancelled");
  });
  it("expiry is judged by the server clock, only for requests that are still pending", () => {
    const past = new Date(now.getTime() - 1);
    expect(deriveLifecycleState({ ...base, expiresAt: past, connectStartedAt: new Date(), pickerSentAt: new Date() }, now)).toBe("expired");
    expect(deriveLifecycleState({ ...base, status: "verified", expiresAt: past }, now)).toBe("connected");
  });
});

describe("beginBotConnect / delivery claims (atomic)", () => {
  beforeEach(async () => {
    await db.delete(pendingChannelRequests).where(eq(pendingChannelRequests.telegramUserId, String(900_900_001)));
  });
  afterAll(async () => {
    await db.delete(pendingChannelRequests).where(eq(pendingChannelRequests.telegramUserId, String(900_900_001)));
  });
  const make = async () => {
    const created = await createPendingChannelRequest({ telegramUserId: 900_900_001, sessionUserId: null, telegramProfile: null }, { method: "bot" });
    return { ...created, record: (await getRequestByToken(created.correlationToken))! };
  };

  it("starts the 10-minute window exactly once; later calls are idempotent and never extend it", async () => {
    const { record } = await make();
    const first = await beginBotConnect(record.id);
    expect(first.kind).toBe("started");
    if (first.kind !== "started") return;
    const ttl = first.pending.expiresAt.getTime() - first.pending.connectStartedAt!.getTime();
    expect(ttl).toBe(CONNECT_WINDOW_MS);
    expect(CONNECT_WINDOW_MS).toBe(10 * 60_000);

    const again = await beginBotConnect(record.id);
    expect(again.kind).toBe("already_started");
    if (again.kind === "already_started") expect(again.pending.expiresAt.getTime()).toBe(first.pending.expiresAt.getTime());
  });

  it("concurrent starts: exactly one wins", async () => {
    const { record } = await make();
    const results = await Promise.all([beginBotConnect(record.id), beginBotConnect(record.id), beginBotConnect(record.id)]);
    expect(results.filter((r) => r.kind === "started")).toHaveLength(1);
  });

  it("an expired or cancelled request can't be started", async () => {
    const { record } = await make();
    await db.update(pendingChannelRequests).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(pendingChannelRequests.id, record.id));
    expect(await beginBotConnect(record.id)).toEqual({ kind: "not_startable", lifecycle: "expired" });

    const b = await make();
    await updatePendingChannelRequestById(b.record.id, { status: "failed", failureReason: "cancelled" });
    expect(await beginBotConnect(b.record.id)).toEqual({ kind: "not_startable", lifecycle: "cancelled" });
  });

  it("an expired request can't be claimed by a late webhook", async () => {
    const { record } = await make();
    await beginBotConnect(record.id);
    await db.update(pendingChannelRequests).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(pendingChannelRequests.id, record.id));
    expect(await claimPendingRequestForProcessing(record.id)).toBe(false);
  });

  it("picker and confirmation deliveries can each be reserved only once", async () => {
    const { record } = await make();
    expect(await claimPickerDelivery(record.id)).toBe(false); // not started yet: nothing may be sent
    await beginBotConnect(record.id);
    expect(await claimPickerDelivery(record.id)).toBe(true);
    expect(await claimPickerDelivery(record.id)).toBe(false);
    await releasePickerDelivery(record.id);
    expect(await claimPickerDelivery(record.id)).toBe(true);

    expect(await claimConfirmationDelivery(record.id)).toBe(true);
    expect(await claimConfirmationDelivery(record.id)).toBe(false);
  });

  it("revertBotConnectStart puts the request back to 'prepared'", async () => {
    const { record, correlationToken } = await make();
    await beginBotConnect(record.id);
    await revertBotConnectStart(record.id);
    expect((await getRequestByToken(correlationToken))?.lifecycle).toBe("prepared");
  });

  it("getRequestByRef is scoped to the owner and to bot-method refs", async () => {
    const { telegramRequestId } = await make();
    expect((await getRequestByRef(900_900_001, telegramRequestId))?.telegramRequestId).toBe(telegramRequestId);
    expect(await getRequestByRef(900_900_002, telegramRequestId)).toBeUndefined();
    expect(await getRequestByRef(900_900_001, 5)).toBeUndefined();
  });
});
