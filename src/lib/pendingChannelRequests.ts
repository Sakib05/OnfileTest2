import crypto from "crypto";
import { and, desc, eq, gt, gte, isNotNull, isNull, lt } from "drizzle-orm";
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

/**
 * Lifecycle of a bot-guided connection request (Start → Connect → bot chat →
 * Return to Onfile). DERIVED, never stored separately, from the row's `status`,
 * `claimed_at`, `connect_started_at`, `picker_sent_at`, `failure_reason` and
 * `expires_at` — see deriveLifecycleState.
 *
 *   prepared                    "Start" tapped: request exists, countdown NOT running yet
 *   connecting                  "Connect" tapped: 10-min countdown running, bot message not delivered yet
 *   awaiting_channel_selection  welcome + native channel picker delivered; waiting for the user
 *   verifying                   a genuine `chat_shared` claimed the request; live Telegram checks running
 *                               (covers both "channel_selected" and "verifying": the claim is atomic)
 *   connected                   verified + channel persisted
 *   failed                      verification failed (reason in `failureReason`)
 *   cancelled                   user cancelled or a newer request superseded it
 *   expired                     still pending but past the server-side `expires_at`
 */
export type ConnectLifecycleState =
  | "prepared"
  | "connecting"
  | "awaiting_channel_selection"
  | "verifying"
  | "connected"
  | "failed"
  | "cancelled"
  | "expired";

export function deriveLifecycleState(
  row: Pick<
    typeof pendingChannelRequests.$inferSelect,
    "status" | "failureReason" | "claimedAt" | "connectStartedAt" | "pickerSentAt" | "expiresAt"
  >,
  now: Date = new Date()
): ConnectLifecycleState {
  if (row.status === "verified") return "connected";
  if (row.status === "failed") return row.failureReason === "cancelled" ? "cancelled" : "failed";
  // status === "pending": the server clock is the source of truth for expiry.
  if (row.expiresAt.getTime() <= now.getTime()) return "expired";
  if (row.claimedAt) return "verifying";
  if (!row.connectStartedAt) return "prepared";
  if (!row.pickerSentAt) return "connecting";
  return "awaiting_channel_selection";
}

export interface PendingChannelRequestRecord {
  id: number;
  telegramRequestId: number;
  identity: ResolvedConnectingIdentity;
  status: PendingChannelStatus;
  failureReason?: string | null;
  channel?: typeof channels.$inferSelect;
  resolvedUserId: number | null;
  isNewAccount: boolean;
  /** True once a webhook delivery has claimed the request and is verifying it. */
  claimed: boolean;
  expiresAt: Date;
  createdAt: Date;
  /** UTC instant the user tapped "Connect" (null while only "prepared"). */
  connectStartedAt: Date | null;
  pickerSentAt: Date | null;
  confirmationSentAt: Date | null;
  /** Derived server-side lifecycle (expiry evaluated against the server clock). */
  lifecycle: ConnectLifecycleState;
}

/**
 * Which connection method created a pending request.
 *   - "direct": Mini App `requestChat` Direct Picker (original flow).
 *   - "bot":    bot-chat `request_chat` keyboard fallback for Telegram
 *               clients that cannot use the Direct Picker.
 *
 * The method is encoded in the Telegram-facing `request_id` range rather
 * than in a new database column, so adding the fallback needs NO schema
 * migration and cannot break a database that hasn't been migrated:
 *   direct: [1, 2^30)        bot: [2^30, 2^31 - 1)
 * Both ranges sit inside the signed 32-bit range Telegram requires for
 * `KeyboardButtonRequestChat.request_id`. The range is only used to decide
 * which *notifications* to send — never as an authorization signal.
 */
export type ConnectMethod = "direct" | "bot";
const BOT_REQUEST_ID_MIN = 1_073_741_824; // 2^30
const REQUEST_ID_MAX_EXCLUSIVE = 2_147_483_647; // 2^31 - 1

export function connectMethodForRequestId(telegramRequestId: number): ConnectMethod {
  return telegramRequestId >= BOT_REQUEST_ID_MIN ? "bot" : "direct";
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
    claimed: row.claimedAt !== null && row.claimedAt !== undefined,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    connectStartedAt: row.connectStartedAt ?? null,
    pickerSentAt: row.pickerSentAt ?? null,
    confirmationSentAt: row.confirmationSentAt ?? null,
    lifecycle: deriveLifecycleState(row),
  };
}

/**
 * Creates a new pending channel connection request. Returns the raw
 * correlation token (only ever handed to the browser — never persisted) and
 * the Telegram-facing `request_id` used to build the `request_chat`
 * keyboard button.
 */
export async function createPendingChannelRequest(
  identity: ResolvedConnectingIdentity,
  options?: { method?: ConnectMethod }
): Promise<{ correlationToken: string; telegramRequestId: number }> {
  cleanupExpired();

  const correlationToken = crypto.randomBytes(24).toString("base64url");
  const tokenHash = hashToken(correlationToken);
  // Signed 32-bit integer range, as required by KeyboardButtonRequestChat.request_id.
  // The sub-range encodes the connection method (see ConnectMethod above).
  const telegramRequestId =
    options?.method === "bot"
      ? crypto.randomInt(BOT_REQUEST_ID_MIN, REQUEST_ID_MAX_EXCLUSIVE)
      : crypto.randomInt(1, BOT_REQUEST_ID_MIN);
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
 * Looks up the most recent still-pending request for a Telegram user,
 * without requiring Telegram's `request_id` (used by the `my_chat_member`
 * webhook fallback path — see src/app/api/telegram/webhook/route.ts — which
 * has no `request_id` to correlate with, only the acting user's Telegram
 * id). Expired rows are excluded, same as every other lookup here.
 */
export async function getLatestPendingByTelegramUser(
  telegramUserId: number
): Promise<PendingChannelRequestRecord | undefined> {
  const [row] = await db
    .select()
    .from(pendingChannelRequests)
    .where(
      and(
        eq(pendingChannelRequests.telegramUserId, String(telegramUserId)),
        eq(pendingChannelRequests.status, "pending"),
        gt(pendingChannelRequests.expiresAt, new Date())
      )
    )
    .orderBy(desc(pendingChannelRequests.createdAt))
    .limit(1);
  if (!row) return undefined;
  return rowToRecord(row);
}

/**
 * Atomically "claims" a pending request for verification/finalization.
 * Returns `true` only for the single caller that wins the race — every
 * other concurrent/duplicate attempt (e.g. a `chat_shared` message AND a
 * `my_chat_member` update both arriving for the same request, or Telegram
 * redelivering the same update) gets `false` and must not proceed. This is
 * what actually prevents a duplicate Telegram update from creating a
 * duplicate connection, on top of the final `status` check.
 *
 * Safe under concurrency: a single `UPDATE ... WHERE status = 'pending' AND
 * claimed_at IS NULL` is evaluated and applied atomically per row by
 * Postgres, so two simultaneous callers can never both see zero rows
 * affected as a false negative, nor both succeed.
 */
export async function claimPendingRequestForProcessing(id: number): Promise<boolean> {
  const result = await db
    .update(pendingChannelRequests)
    .set({ claimedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(pendingChannelRequests.id, id),
        eq(pendingChannelRequests.status, "pending"),
        isNull(pendingChannelRequests.claimedAt),
        // An expired request can never be claimed, even by a webhook that raced the clock.
        gt(pendingChannelRequests.expiresAt, new Date())
      )
    )
    .returning({ id: pendingChannelRequests.id });
  return result.length > 0;
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

/**
 * Supersedes any still-open (pending, unclaimed, unexpired) BOT-method request
 * of this Telegram user, so tapping "Connect channel via bot" repeatedly (or
 * from two devices) never leaves several live requests/keyboards behind — only
 * the newest request can complete. Returns how many were superseded. Direct
 * Picker requests are never touched.
 */
export async function cancelOpenBotRequestsForUser(telegramUserId: number): Promise<number> {
  const result = await db
    .update(pendingChannelRequests)
    .set({ status: "failed", failureReason: "cancelled", updatedAt: new Date() })
    .where(
      and(
        eq(pendingChannelRequests.telegramUserId, String(telegramUserId)),
        eq(pendingChannelRequests.status, "pending"),
        isNull(pendingChannelRequests.claimedAt),
        gt(pendingChannelRequests.expiresAt, new Date()),
        gte(pendingChannelRequests.telegramRequestId, BOT_REQUEST_ID_MIN)
      )
    )
    .returning({ id: pendingChannelRequests.id });
  return result.length;
}

export type StartLookupResult =
  | { kind: "ok"; pending: PendingChannelRequestRecord }
  | { kind: "not_connecting" }
  | { kind: "wrong_user" }
  | { kind: "expired" }
  | { kind: "already_used"; status: PendingChannelStatus }
  | { kind: "unknown" };

/**
 * Classifies a bot-chat `/start <payload>` for the Telegram user who pressed
 * Start, so the bot can answer with a precise, honest explanation instead of
 * a generic error. Unlike getPendingByTelegramRequest this also looks at
 * expired / already-resolved rows (they are retained for 24h) and rows that
 * belong to a different Telegram user — but it only ever *returns* a pending
 * record when ALL of these hold: the row belongs to `telegramUserId`, was
 * created for the bot method, hasn't expired, and is still `pending` and
 * unclaimed. Anything else yields a non-leaking classification with no data.
 */
export async function lookupPendingForBotStart(
  telegramUserId: number,
  telegramRequestId: number
): Promise<StartLookupResult> {
  if (connectMethodForRequestId(telegramRequestId) !== "bot") return { kind: "unknown" };

  const rows = await db
    .select()
    .from(pendingChannelRequests)
    .where(eq(pendingChannelRequests.telegramRequestId, telegramRequestId))
    .orderBy(desc(pendingChannelRequests.createdAt))
    .limit(5);
  if (rows.length === 0) return { kind: "unknown" };

  const mine = rows.find((r) => r.telegramUserId === String(telegramUserId));
  if (!mine) return { kind: "wrong_user" };

  const record = rowToRecord(mine);
  if (mine.status !== "pending" || mine.claimedAt) return { kind: "already_used", status: mine.status };
  if (mine.expiresAt.getTime() <= Date.now()) return { kind: "expired" };
  // Bot-guided flow: the picker is only ever delivered after the user tapped
  // "Connect" in the Mini App (that is what starts the 10-minute window).
  if (!mine.connectStartedAt) return { kind: "not_connecting" };
  return { kind: "ok", pending: record };
}

/**
 * Most recent still-pending BOT-method request for a Telegram user — used by
 * the `/connect` command so a user who already started the bot can get the
 * channel-selection keyboard again without re-tapping a deep link.
 */
export async function getLatestPendingBotRequestForUser(
  telegramUserId: number
): Promise<PendingChannelRequestRecord | undefined> {
  const rows = await db
    .select()
    .from(pendingChannelRequests)
    .where(
      and(
        eq(pendingChannelRequests.telegramUserId, String(telegramUserId)),
        eq(pendingChannelRequests.status, "pending"),
        isNull(pendingChannelRequests.claimedAt),
        isNotNull(pendingChannelRequests.connectStartedAt),
        gt(pendingChannelRequests.expiresAt, new Date())
      )
    )
    .orderBy(desc(pendingChannelRequests.createdAt))
    .limit(10);
  const row = rows.find((r) => connectMethodForRequestId(r.telegramRequestId) === "bot");
  return row ? rowToRecord(row) : undefined;
}

// ─── Bot-guided connection flow: lifecycle helpers ──────────────────────────

/** Authoritative length of the connection window, started by "Connect". */
export const CONNECT_WINDOW_MS = TTL_MS;

async function selectRequestRow(where: ReturnType<typeof and>) {
  const [row] = await db.select().from(pendingChannelRequests).where(where).orderBy(desc(pendingChannelRequests.createdAt)).limit(1);
  if (!row) return undefined;
  const record = rowToRecord(row);
  if (row.resolvedChannelId) {
    const [channel] = await db.select().from(channels).where(eq(channels.id, row.resolvedChannelId)).limit(1);
    record.channel = channel;
  }
  return record;
}

/**
 * Reads a request by the browser's opaque bearer token INCLUDING expired and
 * resolved rows (unlike getPendingByToken), so the API can answer "expired" /
 * "connected" / "failed" explicitly instead of "not found". Rows are retained
 * 24h. The caller must still compare `identity.telegramUserId` with the
 * authenticated user.
 */
export async function getRequestByToken(token: string): Promise<PendingChannelRequestRecord | undefined> {
  return selectRequestRow(eq(pendingChannelRequests.tokenHash, hashToken(token)));
}

/**
 * Reads a request by (authenticated Telegram user, public request ref). The
 * ref is the Telegram-facing `request_id` carried by the "Return to Onfile"
 * link — NOT a secret and NOT proof of anything: the lookup is scoped to the
 * server-side authenticated user, so another user's ref finds nothing.
 * Bot-method requests only.
 */
export async function getRequestByRef(
  telegramUserId: number,
  ref: number
): Promise<PendingChannelRequestRecord | undefined> {
  if (!Number.isInteger(ref) || connectMethodForRequestId(ref) !== "bot") return undefined;
  return selectRequestRow(
    and(eq(pendingChannelRequests.telegramUserId, String(telegramUserId)), eq(pendingChannelRequests.telegramRequestId, ref))
  );
}

/** The authenticated user's most recent bot-method request (any state, within retention). */
export async function getLatestBotRequestForUser(telegramUserId: number): Promise<PendingChannelRequestRecord | undefined> {
  return selectRequestRow(
    and(
      eq(pendingChannelRequests.telegramUserId, String(telegramUserId)),
      gte(pendingChannelRequests.telegramRequestId, BOT_REQUEST_ID_MIN)
    )
  );
}

export type BeginConnectResult =
  | { kind: "started"; pending: PendingChannelRequestRecord }
  /** Already started earlier (retry / double tap): idempotent, the window is NOT extended. */
  | { kind: "already_started"; pending: PendingChannelRequestRecord }
  | { kind: "not_startable"; lifecycle: ConnectLifecycleState };

/**
 * "Connect": atomically starts the server-side 10-minute window. One
 * `UPDATE ... WHERE status='pending' AND unclaimed AND not expired AND
 * connect_started_at IS NULL`, so concurrent / repeated calls start the
 * window exactly once and an expired request can never be started.
 */
export async function beginBotConnect(id: number): Promise<BeginConnectResult> {
  const now = new Date();
  const updated = await db
    .update(pendingChannelRequests)
    .set({ connectStartedAt: now, expiresAt: new Date(now.getTime() + CONNECT_WINDOW_MS), updatedAt: now })
    .where(
      and(
        eq(pendingChannelRequests.id, id),
        eq(pendingChannelRequests.status, "pending"),
        isNull(pendingChannelRequests.claimedAt),
        isNull(pendingChannelRequests.connectStartedAt),
        gt(pendingChannelRequests.expiresAt, now)
      )
    )
    .returning({ id: pendingChannelRequests.id });

  const current = await selectRequestRow(eq(pendingChannelRequests.id, id));
  if (!current) return { kind: "not_startable", lifecycle: "expired" };
  if (updated.length > 0) return { kind: "started", pending: current };
  if (current.connectStartedAt && (current.lifecycle === "connecting" || current.lifecycle === "awaiting_channel_selection")) {
    return { kind: "already_started", pending: current };
  }
  return { kind: "not_startable", lifecycle: current.lifecycle };
}

/** Puts a request back to "prepared" after the bot message could not be delivered (so "Connect" can be retried). */
export async function revertBotConnectStart(id: number): Promise<void> {
  await db
    .update(pendingChannelRequests)
    .set({ connectStartedAt: null, pickerSentAt: null, updatedAt: new Date() })
    .where(
      and(
        eq(pendingChannelRequests.id, id),
        eq(pendingChannelRequests.status, "pending"),
        isNull(pendingChannelRequests.claimedAt)
      )
    );
}

/**
 * Atomically reserves the right to deliver the picker message for this
 * request (`picker_sent_at IS NULL` → now). Returns false when someone else
 * already did, so a retried "Connect" call can never send a second message.
 */
export async function claimPickerDelivery(id: number): Promise<boolean> {
  const r = await db
    .update(pendingChannelRequests)
    .set({ pickerSentAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(pendingChannelRequests.id, id),
        eq(pendingChannelRequests.status, "pending"),
        isNull(pendingChannelRequests.claimedAt),
        isNull(pendingChannelRequests.pickerSentAt),
        isNotNull(pendingChannelRequests.connectStartedAt),
        gt(pendingChannelRequests.expiresAt, new Date())
      )
    )
    .returning({ id: pendingChannelRequests.id });
  return r.length > 0;
}

/** Gives the delivery reservation back after the send failed. */
export async function releasePickerDelivery(id: number): Promise<void> {
  await db
    .update(pendingChannelRequests)
    .set({ pickerSentAt: null, updatedAt: new Date() })
    .where(and(eq(pendingChannelRequests.id, id), eq(pendingChannelRequests.status, "pending")));
}

/** Records (once) that the picker message reached the user via the webhook's /start path. */
export async function markPickerSent(id: number): Promise<void> {
  await db
    .update(pendingChannelRequests)
    .set({ pickerSentAt: new Date(), updatedAt: new Date() })
    .where(and(eq(pendingChannelRequests.id, id), isNull(pendingChannelRequests.pickerSentAt)));
}

/** Atomically reserves the one-and-only "Congratulations" message for a request. */
export async function claimConfirmationDelivery(id: number): Promise<boolean> {
  const r = await db
    .update(pendingChannelRequests)
    .set({ confirmationSentAt: new Date(), updatedAt: new Date() })
    .where(and(eq(pendingChannelRequests.id, id), isNull(pendingChannelRequests.confirmationSentAt)))
    .returning({ id: pendingChannelRequests.id });
  return r.length > 0;
}
