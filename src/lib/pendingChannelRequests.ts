import crypto from "crypto";
import type { channels } from "@/db/schema";
import type { ResolvedConnectingIdentity } from "@/lib/channelConnection";

/**
 * Short-lived, in-memory correlation state for the native Telegram
 * "select a chat, then add the bot as admin" connection flow.
 *
 * Why in-memory and not a DB table? The data here is purely transient
 * routing information — "which browser session is waiting for which
 * Telegram `request_chat` reply" — never a durable business record. Nothing
 * here is trusted as proof of anything; the actual channel row is only ever
 * written after independent Bot API verification (see
 * src/lib/channelConnection.ts). This mirrors the existing pattern in
 * src/lib/rateLimit.ts.
 *
 * Limitation (documented for the deployment/security review, same as
 * rateLimit.ts): this state is per server process. On a horizontally
 * scaled / multi-instance deployment, the instance that receives the
 * Telegram webhook call must be the same one the browser is polling, or a
 * shared store (Redis, etc.) is required. Single-instance deployments
 * (including this environment) are unaffected.
 */

export type PendingChannelStatus = "pending" | "verified" | "failed";

export interface PendingChannelRequest {
  /** Opaque token handed to the browser; never guessable, never exposed to Telegram. */
  correlationToken: string;
  /** The signed 32-bit id Telegram echoes back inside the `chat_shared` service message. */
  telegramRequestId: number;
  identity: ResolvedConnectingIdentity;
  status: PendingChannelStatus;
  failureReason?: string;
  channel?: typeof channels.$inferSelect;
  newSession?: { token: string; expiresAt: Date };
  createdAt: number;
}

const TTL_MS = 10 * 60 * 1000; // 10 minutes

const byToken = new Map<string, PendingChannelRequest>();
// Keyed by `${telegramUserId}:${telegramRequestId}` so the webhook (which only
// knows the Telegram user id + the request id Telegram echoes back) can find
// the matching browser-side request without trusting any client input.
const byTelegramRequest = new Map<string, string>();

function cleanupExpired() {
  const now = Date.now();
  for (const [token, entry] of byToken) {
    if (now - entry.createdAt > TTL_MS) {
      byToken.delete(token);
      byTelegramRequest.delete(`${entry.identity.telegramUserId}:${entry.telegramRequestId}`);
    }
  }
}

setInterval(cleanupExpired, 60_000).unref?.();

export function createPendingChannelRequest(identity: ResolvedConnectingIdentity): PendingChannelRequest {
  cleanupExpired();
  const correlationToken = crypto.randomBytes(24).toString("base64url");
  // Signed 32-bit integer range, as required by KeyboardButtonRequestChat.request_id.
  const telegramRequestId = crypto.randomInt(1, 2_147_483_647);

  const entry: PendingChannelRequest = {
    correlationToken,
    telegramRequestId,
    identity,
    status: "pending",
    createdAt: Date.now(),
  };

  byToken.set(correlationToken, entry);
  byTelegramRequest.set(`${identity.telegramUserId}:${telegramRequestId}`, correlationToken);
  return entry;
}

export function getPendingByToken(token: string): PendingChannelRequest | undefined {
  return byToken.get(token);
}

export function getPendingByTelegramRequest(telegramUserId: number, telegramRequestId: number): PendingChannelRequest | undefined {
  const token = byTelegramRequest.get(`${telegramUserId}:${telegramRequestId}`);
  if (!token) return undefined;
  return byToken.get(token);
}

export function updatePendingChannelRequest(token: string, patch: Partial<PendingChannelRequest>) {
  const entry = byToken.get(token);
  if (!entry) return;
  Object.assign(entry, patch);
}
