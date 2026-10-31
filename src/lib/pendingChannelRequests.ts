import crypto from "crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import { db } from "@/db";
import { channels, pendingChannelRequests } from "@/db/schema";
import type { ResolvedConnectingIdentity } from "@/lib/channelConnection";

/**
 * Durable, database-backed correlation state for the native Telegram
 * "select a chat, then add the bot as admin" connection flow.
 *
 * Why a database table and not in-memory (as a previous version of this
 * file did)? On Vercel, the serverless instance that receives the Telegram
 * webhook call is not guaranteed to be the same process that handled the
 * browser's original "start connecting" request, and any instance can be
 * recycled at any time. An in-memory Map is therefore unsafe: webhook
 * deliveries could silently find nothing to resolve, and the browser's
 * polling could error out after a cold start. Persisting this state in
 * Postgres (via the existing Drizzle setup) fixes both problems without
 * introducing new infrastructure.
 *
 * Nothing stored here is ever trusted as proof of anything on its own — the
 * actual `channels` row is only ever written after an independent, live
 * Telegram Bot API check (see src/lib/channelConnection.ts and
 * src/lib/telegramBot.ts). This table only stores short-lived routing state
 * and the outcome of that verification.
 *
 * Security properties:
 *   - The correlation token handed to the browser is never itself stored;
 *     only its SHA-256 hash is persisted (same pattern as `sessions`), so a
 *     database read alone cannot be replayed as a valid bearer token.
 *   - Each row is scoped to exactly one Telegram user + one Telegram-issued
 *     `request_id`, so a webhook delivery can only ever resolve the single
 *     matching pending request — never another user's.
 *   - Rows carry an explicit `expiresAt`; every read filters on it, so an
 *     expired request behaves exactly like a missing one.
 *   - The webhook is idempotent: once a row's status leaves "pending", a
 *     duplicate/retried Telegram update for the same `request_id` is a
 *     documented no-op (see src/app/api/telegram/webhook/route.ts).
 */

export type PendingChannelStatus = "pending" | "verified" | "failed";

export interface PendingChannelRequestRecord {
  id: number;
  telegramRequestId: number;
  identity: ResolvedConnectingIdentity;
  status: PendingChannelStatus;
  failureReason?: string | null;
  channel?: typeof channels.$inferSelect;
  resolvedUserId: number | null;
  isNewAccount: boolean;
}

const TTL_MS = 10 * 60 * 1000; // 10 minutes
// Keep resolved/expired rows around briefly for debugging/idempotency checks,
// then let opportunistic cleanup remove them instead of growing forever.
const RETENTION_MS = 24 * 60 * 60 * 1000; // 24 hours

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** Best-effort deletion of long-expired rows. Never blocks the caller. */
function cleanupExpired() {
  const cutoff = new Date(Date.now() - RETENTION_MS);
  db.delete(pendingChannelRequests)
    .where(lt(pendingChannelRequests.expiresAt, cutoff))
    .catch((err) => {
      console.error("pending_channel_requests_cleanup_failed", err instanceof Error ? err.message : "unknown_error");
    });
}

function rowToIdentity(row: typeof pendingChannelRequests.$inferSelect): ResolvedConnectingIdentity {
  let telegramProfile: ResolvedConnectingIdentity["telegramProfile"] = null;
  if (row.telegramProfile) {
    try {
      telegramProfile = JSON.parse(row.telegramProfile);
    } catch {
      telegramProfile = null;
    }
  }
  return {
    telegramUserId: Number(row.telegramUserId),
    sessionUserId: row.sessionUserId ?? null,
    telegramProfile,
  };
}

function rowToRecord(row: typeof pendingChannelRequests.$inferSelect): PendingChannelRequestRecord {
  return {
    id: row.id,
    telegramRequestId: row.telegramRequestId,
    identity: rowToIdentity(row),
    status: row.status,
    failureReason: row.failureReason,
    resolvedUserId: row.resolvedUserId,
    isNewAccount: row.isNewAccount,
  };
}

/**
 * Creates a new pending channel connection request. Returns the raw
 * correlation token (only ever handed to the browser — never persisted) and
 * the Telegram-facing `request_id` used to build the `request_chat`
 * keyboard button.
 */
export async function createPendingChannelRequest(
  identity: ResolvedConnectingIdentity
): Promise<{ correlationToken: string; telegramRequestId: number }> {
  cleanupExpired();

  const correlationToken = crypto.randomBytes(24).toString("base64url");
  const tokenHash = hashToken(correlationToken);
  // Signed 32-bit integer range, as required by KeyboardButtonRequestChat.request_id.
  const telegramRequestId = crypto.randomInt(1, 2_147_483_647);
  const expiresAt = new Date(Date.now() + TTL_MS);

  await db.insert(pendingChannelRequests).values({
    tokenHash,
    telegramRequestId,
    telegramUserId: String(identity.telegramUserId),
    sessionUserId: identity.sessionUserId,
    telegramProfile: identity.telegramProfile ? JSON.stringify(identity.telegramProfile) : null,
    status: "pending",
    expiresAt,
  });

  return { correlationToken, telegramRequestId };
}

/** Looks up a pending request by the browser's opaque bearer token. */
export async function getPendingByToken(token: string): Promise<PendingChannelRequestRecord | undefined> {
  const tokenHash = hashToken(token);
  const [row] = await db
    .select()
    .from(pendingChannelRequests)
    .where(and(eq(pendingChannelRequests.tokenHash, tokenHash), gt(pendingChannelRequests.expiresAt, new Date())))
    .limit(1);
  if (!row) return undefined;

  const record = rowToRecord(row);
  if (row.resolvedChannelId) {
    const [channel] = await db.select().from(channels).where(eq(channels.id, row.resolvedChannelId)).limit(1);
    record.channel = channel;
  }
  return record;
}

/**
 * Looks up a pending request by the (Telegram user id, Telegram request id)
 * pair the webhook payload supplies. This pair is Telegram-issued and
 * unguessable by a third party in practice, but even so nothing is ever
 * persisted based on this lookup alone — see verifyChannelOwnershipAndBotAccess.
 * Expired requests are intentionally excluded so a late/duplicate webhook
 * for a long-gone request is treated as "unknown" rather than resurrected.
 */
export async function getPendingByTelegramRequest(
  telegramUserId: number,
  telegramRequestId: number
): Promise<PendingChannelRequestRecord | undefined> {
  const [row] = await db
    .select()
    .from(pendingChannelRequests)
    .where(
      and(
        eq(pendingChannelRequests.telegramUserId, String(telegramUserId)),
        eq(pendingChannelRequests.telegramRequestId, telegramRequestId),
        gt(pendingChannelRequests.expiresAt, new Date())
      )
    )
    .orderBy(pendingChannelRequests.createdAt)
    .limit(1);
  if (!row) return undefined;
  return rowToRecord(row);
}

export interface PendingChannelRequestPatch {
  status?: PendingChannelStatus;
  failureReason?: string | null;
  resolvedUserId?: number | null;
  resolvedChannelId?: number | null;
  isNewAccount?: boolean;
}

/** Updates a pending request by its database id (never the raw token). */
export async function updatePendingChannelRequestById(id: number, patch: PendingChannelRequestPatch): Promise<void> {
  await db
    .update(pendingChannelRequests)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(pendingChannelRequests.id, id));
}

/**
 * Marks a still-pending request as cancelled, keyed by the browser's own
 * bearer token (never a Telegram id supplied by the client). Called when
 * `Telegram.WebApp.requestChat`'s callback reports the selection was not
 * sent (user dismissed the native picker, or Telegram could not deliver the
 * `chat_shared` service message) — this keeps the browser's poll from
 * waiting the full TTL for a request that will never resolve, without ever
 * trusting the client's report of *why* it failed for anything beyond this
 * cosmetic status. A request that already resolved (verified/failed via the
 * webhook) is left untouched — this is a no-op in that case, not an error.
 */
export async function cancelPendingByToken(token: string): Promise<boolean> {
  const tokenHash = hashToken(token);
  const result = await db
    .update(pendingChannelRequests)
    .set({ status: "failed", failureReason: "cancelled", updatedAt: new Date() })
    .where(
      and(
        eq(pendingChannelRequests.tokenHash, tokenHash),
        eq(pendingChannelRequests.status, "pending"),
        gt(pendingChannelRequests.expiresAt, new Date())
      )
    )
    .returning({ id: pendingChannelRequests.id });
  return result.length > 0;
}
