import { CHANNEL_FAILURE_MESSAGES, finalizeVerifiedChannelConnection } from "@/lib/channelConnection";
import { notifyUser } from "@/lib/notifications";
import { notifyBotConnectionFailure } from "@/lib/botConnectFlow";
import {
  claimSelectedChannelForVerification,
  connectMethodForRequestId,
  releaseVerificationClaim,
  updatePendingChannelRequestById,
  type PendingChannelRequestRecord,
} from "@/lib/pendingChannelRequests";
import { verifyChannelOwnershipAndBotAccess } from "@/lib/telegramBot";

/**
 * The ONE place where a selected channel is verified against Telegram and connected.
 *
 * It is reached only from POST /api/channels/connect-verify, i.e. only after the user tapped the bot's
 * "Verify" button and the Mini App asked the backend to verify. The Telegram webhook (`chat_shared`,
 * `my_chat_member`, …) never calls it: the webhook only stores the selection and sends the Verify message.
 *
 * Nothing is taken from the client except the public request reference / bearer token that LOCATES the
 * request. The channel id comes from the row the webhook stored, and the Telegram identity from the
 * authenticated session / signed setup cookie (the caller has already checked that the request belongs to it).
 *
 * Verification (verifyChannelOwnershipAndBotAccess) checks, live against the Bot API: the chat exists and is a
 * channel; it is PRIVATE (no public username); the Telegram user is the creator or an administrator; the Onfile
 * bot is an administrator there and holds the required permissions. Finalization (finalizeVerifiedChannelConnection)
 * runs only after every one of those succeeded.
 *
 * Concurrency / replay: `claimSelectedChannelForVerification` is a single atomic UPDATE, so of any number of
 * simultaneous or repeated calls exactly one proceeds; the others report `verifying` / the resolved outcome.
 * A resolved request (`verified` / `failed`) is never re-verified, and the claim also fails once the request expired.
 */
export type VerifyStepResult =
  /** Past the server-side expiry (or no longer claimable because it expired meanwhile). */
  | { kind: "expired" }
  /** No channel has been shared for this request yet — nothing to verify. */
  | { kind: "awaiting_selection" }
  /** Another call currently holds the claim and is verifying. */
  | { kind: "verifying" }
  /** The request was already resolved (verified / failed / cancelled): report it, do nothing. */
  | { kind: "already_resolved" }
  /** This call verified AND connected the channel. */
  | { kind: "verified" }
  /** Verification (or finalization) failed; the request is now `failed` and nothing was connected. */
  | { kind: "failed"; reason: string }
  /** Telegram could not be reached: nothing was decided, the claim was released, tapping Verify again retries. */
  | { kind: "retryable"; reason: string };

/** Only a transient outage is retryable; every other failure is a final verdict about this request. */
const RETRYABLE_REASONS = new Set(["telegram_api_error"]);

export async function verifyPendingChannelRequest(
  pending: PendingChannelRequestRecord,
  userAgent: string | null
): Promise<VerifyStepResult> {
  if (pending.status !== "pending") return { kind: "already_resolved" };
  if (pending.lifecycle === "expired" || pending.expiresAt.getTime() <= Date.now()) return { kind: "expired" };

  // A bot-guided request only counts once "Connect" started its window.
  const method = connectMethodForRequestId(pending.telegramRequestId);
  if (method === "bot" && !pending.connectStartedAt) return { kind: "awaiting_selection" };
  if (!pending.selectedChatId) return { kind: "awaiting_selection" };
  if (pending.claimed) return { kind: "verifying" };

  // Atomic: exactly one caller wins, and it receives the channel id the webhook stored for this request.
  const selectedChatId = await claimSelectedChannelForVerification(pending.id);
  if (!selectedChatId) {
    // Lost a race (someone else is verifying / already resolved it) or the request expired a moment ago.
    return pending.expiresAt.getTime() <= Date.now() ? { kind: "expired" } : { kind: "verifying" };
  }

  const telegramUserId = pending.identity.telegramUserId;
  const verification = await verifyChannelOwnershipAndBotAccess(selectedChatId, telegramUserId);
  if (!verification.ok) {
    console.log("connect_verify_verification_failed", { pendingId: pending.id, reason: verification.reason });
    if (RETRYABLE_REASONS.has(verification.reason)) {
      await releaseVerificationClaim(pending.id);
      return { kind: "retryable", reason: verification.reason };
    }
    return fail(pending, telegramUserId, verification.reason);
  }

  // Session creation for brand-new accounts is deferred to the status endpoint, which can deliver the cookie
  // (see FinalizeOptions in src/lib/channelConnection.ts).
  const finalized = await finalizeVerifiedChannelConnection(verification, pending.identity, userAgent, {
    createSessionForNewAccount: false,
  });
  if (!finalized.ok) {
    console.error("connect_verify_finalize_failed", { pendingId: pending.id, error: finalized.error });
    // 409 = this channel is already connected to another Onfile account: a final verdict.
    if (finalized.status === 409) return fail(pending, telegramUserId, "channel_already_connected");
    // Our own storage hiccup, nothing was connected: let the user retry instead of burning the request.
    await releaseVerificationClaim(pending.id);
    return { kind: "retryable", reason: "telegram_api_error" };
  }

  console.log("connect_verify_connection_persisted", { pendingId: pending.id, channelId: finalized.result.channel.id });
  await updatePendingChannelRequestById(pending.id, {
    status: "verified",
    resolvedChannelId: finalized.result.channel.id,
    resolvedUserId: finalized.result.userId,
    isNewAccount: finalized.result.isNewAccount,
  });
  return { kind: "verified" };
}

/** Marks the request failed (a channel is NEVER connected on this path) and tells the user. */
async function fail(pending: PendingChannelRequestRecord, telegramUserId: number, reason: string): Promise<VerifyStepResult> {
  await updatePendingChannelRequestById(pending.id, { status: "failed", failureReason: reason });
  await Promise.allSettled([
    connectMethodForRequestId(pending.telegramRequestId) === "bot"
      ? notifyBotConnectionFailure(telegramUserId, reason, null)
      : Promise.resolve(),
    notifyConnectionFailed(pending, reason),
  ]);
  return { kind: "failed", reason };
}

/**
 * Genuine backend event: a verification the user started failed. Only an EXISTING account (a session user)
 * has somewhere to receive an in-app notification; a brand-new Telegram identity has no account yet and sees
 * the failure on the Verify screen instead. Never throws.
 */
async function notifyConnectionFailed(pending: PendingChannelRequestRecord, reason: string) {
  const userId = pending.identity.sessionUserId;
  if (!userId) return;
  await notifyUser({
    userId,
    type: "channel_connection_failed",
    title: "Channel connection needs attention",
    body: CHANNEL_FAILURE_MESSAGES[reason] ?? "We couldn't verify the channel you selected. Please try again.",
    destination: { type: "channels" },
    dedupeKey: `channel_connect_failed:${pending.id}`,
  });
}
