import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { telegramUpdateLog } from "@/db/schema";
import { getOwnBotId, verifyChannelOwnershipAndBotAccess } from "@/lib/telegramBot";
import { finalizeVerifiedChannelConnection } from "@/lib/channelConnection";
import {
  claimPendingRequestForProcessing,
  connectMethodForRequestId,
  getLatestPendingByTelegramUser,
  getPendingByTelegramRequest,
  lookupPendingForBotStart,
  updatePendingChannelRequestById,
  type PendingChannelRequestRecord,
} from "@/lib/pendingChannelRequests";
import { recordBotChannelAdminEvent } from "@/lib/botChannelEvents";
import { markPrivateChatBlocked, recordPrivateChat } from "@/lib/botPrivateChats";
import {
  handleBotTextMessage,
  notifyBotConnectionFailure,
  notifyBotConnectionSuccess,
  notifyBotRequestExpired,
} from "@/lib/botConnectFlow";

interface TelegramChatShared {
  request_id: number;
  chat_id: number;
  title?: string;
  username?: string;
}

interface TelegramChatRef {
  id: number;
  type: string;
  title?: string;
  username?: string;
}

interface TelegramChatMemberRef {
  status: string;
  user: { id: number };
  can_post_messages?: boolean;
}

interface TelegramChatMemberUpdated {
  chat: TelegramChatRef;
  from: { id: number };
  date: number;
  old_chat_member: TelegramChatMemberRef;
  new_chat_member: TelegramChatMemberRef;
}

interface TelegramUpdate {
  update_id: number;
  message?: {
    chat: { id: number; type: string };
    from?: { id: number; is_bot?: boolean };
    text?: string;
    chat_shared?: TelegramChatShared;
  };
  my_chat_member?: TelegramChatMemberUpdated;
}

/**
 * Receives Telegram Bot API updates for both Channel Connection flows:
 *
 *   - `chat_shared` (nested in `message`): Telegram's confirmation that a
 *     user picked a channel via the native `request_chat` picker ("Connect
 *     Channel via Bot" — see /api/channels/connect-request).
 *   - `my_chat_member`: fired whenever OUR BOT's own membership/admin status
 *     changes in any chat. This is required for two reasons:
 *       1. Manual Connect (see /api/channels/connect-manual) has no
 *          `request_chat` flow at all — the only way to discover which
 *          channel a user just added the bot to as administrator is this
 *          update. Previously this route silently dropped it entirely.
 *       2. As a resilience fallback for "Connect Channel via Bot": if
 *          `chat_shared` is ever delayed or not delivered for any reason,
 *          `my_chat_member` independently confirms the same fact (bot
 *          became administrator in channel X, added by Telegram user Y)
 *          and can complete the same pending request.
 *
 * Nothing from either update is trusted at face value: the bot's admin
 * status and the requesting user's admin status are independently
 * re-verified against the live Telegram Bot API before anything is
 * persisted (see verifyChannelOwnershipAndBotAccess). This endpoint is
 * idempotent at two layers:
 *   1. Telegram `update_id`s are logged in `telegram_update_log`; a redelivered
 *      update is detected and skipped before any processing happens.
 *   2. Each pending request can only be "claimed" for verification once
 *      (see claimPendingRequestForProcessing) — so even if `chat_shared` and
 *      `my_chat_member` both arrive for the same request, only one of them
 *      performs verification + persistence.
 * This route always responds 200 so Telegram does not endlessly retry
 * delivery for application-level failures that a retry can't fix.
 *
 * Requires `TELEGRAM_WEBHOOK_SECRET` to be configured and the webhook to be
 * registered with Telegram (via `setWebhook`, including the matching
 * `secret_token` AND `allowed_updates` containing at least `"message"` and
 * `"my_chat_member"` — see scripts/configure-telegram-webhook.mjs) outside
 * of this code — that one-time setup is a deployment step, not something
 * this route can perform for itself.
 */
export async function POST(req: NextRequest) {
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (expectedSecret) {
    const providedSecret = req.headers.get("x-telegram-bot-api-secret-token");
    if (providedSecret !== expectedSecret) {
      console.error("telegram_webhook_rejected", { reason: "bad_secret_token" });
      return NextResponse.json({ ok: false }, { status: 401 });
    }
  }

  let update: TelegramUpdate;
  try {
    update = await req.json();
  } catch {
    console.error("telegram_webhook_invalid_json");
    return NextResponse.json({ ok: true });
  }

  // --- Idempotency layer 1: never process the same Telegram update twice. ---
  if (typeof update.update_id === "number") {
    try {
      const inserted = await db
        .insert(telegramUpdateLog)
        .values({ updateId: update.update_id })
        .onConflictDoNothing()
        .returning({ id: telegramUpdateLog.id });
      if (inserted.length === 0) {
        console.log("telegram_webhook_duplicate_update_skipped", { updateId: update.update_id });
        return NextResponse.json({ ok: true });
      }
    } catch (err) {
      // Logging failure must never block processing a genuinely new update.
      console.error("telegram_webhook_update_log_failed", err instanceof Error ? err.message : "unknown_error");
    }
  }

  try {
    const updateType = update.my_chat_member ? "my_chat_member" : update.message?.chat_shared ? "chat_shared" : "unhandled";
    console.log("telegram_webhook_received", { updateId: update.update_id, updateType });

    // Remember the verified private chat (user id → chat id) so the backend can
    // later message the user in their EXISTING conversation without a "/start".
    // Only trusted, secret-authenticated webhook updates reach this point.
    if (update.message) await recordPrivateChatFromMessage(update.message);

    if (update.my_chat_member) {
      await handleMyChatMember(update.my_chat_member, req);
      return NextResponse.json({ ok: true });
    }

    if (update.message?.chat_shared && update.message.from?.id) {
      await handleChatShared(update.message.chat_shared, update.message.from.id, req, update.message.chat);
      return NextResponse.json({ ok: true });
    }

    // Bot-chat fallback ("Connect channel via bot"): `/start <payload>` and
    // `/connect` in a private chat. Never touches `channels` directly — see
    // src/lib/botConnectFlow.ts.
    if (update.message?.text && update.message.from?.id) {
      await handleBotTextMessage({
        chatId: update.message.chat.id,
        chatType: update.message.chat.type,
        fromId: update.message.from.id,
        text: update.message.text,
      });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("telegram_webhook_failed", err instanceof Error ? err.message : "unknown_error");
    // Still 200: Telegram would otherwise retry indefinitely for a problem
    // that a retry won't fix.
    return NextResponse.json({ ok: true });
  }
}

/** Handles the native chat-picker flow's confirmation message. */
async function handleChatShared(
  chatShared: TelegramChatShared,
  telegramUserId: number,
  req: NextRequest,
  messageChat: { id: number; type: string }
) {
  // `chat_shared` is delivered inside the user's private chat with the bot —
  // the chat Telegram says it came from is where confirmations are sent.
  const observedChatId = messageChat.type === "private" ? messageChat.id : null;
  const pending = await getPendingByTelegramRequest(telegramUserId, chatShared.request_id);
  if (!pending) {
    console.log("telegram_webhook_chat_shared_no_pending_request", {
      telegramUserId,
      requestId: chatShared.request_id,
    });
    // Only for the bot-chat fallback: the user is looking at the bot chat, so
    // tell them (rather than staying silent) that their request expired.
    // getPendingByTelegramRequest already excludes expired rows, and the
    // bot-range check keeps the Direct Picker's behavior unchanged.
    // A selection from the wrong user, or for an unknown/already-resolved
    // request, is ignored silently; only a genuine expiry is announced.
    if (connectMethodForRequestId(chatShared.request_id) === "bot") {
      const lookup = await lookupPendingForBotStart(telegramUserId, chatShared.request_id);
      if (lookup.kind === "expired") {
        await safeNotify(() => notifyBotRequestExpired(telegramUserId, observedChatId));
      }
    }
    return;
  }
  await resolvePendingAgainstChat(pending, String(chatShared.chat_id), telegramUserId, req, "chat_shared", observedChatId);
}

/**
 * Handles a `my_chat_member` update about our own bot. Always records the
 * latest known membership state (used by Manual Connect's discovery lookup),
 * and — only when the bot was just promoted to administrator — attempts to
 * complete a matching pending "Connect Channel via Bot" request as a
 * resilience fallback to `chat_shared`.
 */
async function handleMyChatMember(update: TelegramChatMemberUpdated, req: NextRequest) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    console.error("telegram_webhook_my_chat_member_skipped", { reason: "missing_bot_token" });
    return;
  }

  const ownBotId = await getOwnBotId(botToken);
  if (!ownBotId || update.new_chat_member.user.id !== ownBotId) {
    // Not an update about our own bot — nothing for this handler to do.
    return;
  }

  // The bot's membership in a PRIVATE chat is the user starting / blocking /
  // unblocking the bot. Keep the verified user → chat association current.
  if (update.chat.type === "private") {
    await handlePrivateChatMembership(update);
    return;
  }

  const isChannel = update.chat.type === "channel";
  const actingUserId = update.from?.id;
  if (!actingUserId) {
    console.log("telegram_webhook_my_chat_member_missing_actor", { chatId: update.chat.id });
    return;
  }

  console.log("telegram_webhook_my_chat_member", {
    chatId: update.chat.id,
    isChannel,
    newStatus: update.new_chat_member.status,
    actingUserId,
  });

  if (isChannel) {
    try {
      await recordBotChannelAdminEvent({
        telegramChatId: String(update.chat.id),
        telegramUserId: String(actingUserId),
        chatTitle: update.chat.title ?? null,
        chatUsername: update.chat.username ?? null,
        isChannel: true,
        botStatus: update.new_chat_member.status,
        canPostMessages: update.new_chat_member.can_post_messages ?? null,
      });
    } catch (err) {
      console.error("telegram_webhook_record_admin_event_failed", err instanceof Error ? err.message : "unknown_error");
    }
  }

  // Fallback completion path for "Connect Channel via Bot": only relevant
  // when the bot just became an administrator of a channel.
  if (!isChannel || update.new_chat_member.status !== "administrator") {
    return;
  }

  const pending = await getLatestPendingByTelegramUser(actingUserId);
  if (!pending) {
    // No in-flight "Connect Channel via Bot" request for this user — most
    // likely this is a Manual Connect admin event, which is fine; the
    // discovery row recorded above is exactly what that flow needs.
    return;
  }

  await resolvePendingAgainstChat(pending, String(update.chat.id), actingUserId, req, "my_chat_member");
}

/** Records (user → private chat) from any update of a human user's message in a private chat. */
async function recordPrivateChatFromMessage(message: NonNullable<TelegramUpdate["message"]>) {
  if (message.chat.type !== "private" || !message.from?.id || message.from.is_bot) return;
  try {
    await recordPrivateChat(message.from.id, message.chat.id, "webhook");
  } catch (err) {
    // Never block processing of the update itself (e.g. table not migrated yet).
    console.error("telegram_webhook_record_private_chat_failed", err instanceof Error ? err.message : "unknown_error");
  }
}

/** `my_chat_member` in a private chat: "kicked" = user blocked the bot; "member" = (re)started / unblocked. */
async function handlePrivateChatMembership(update: TelegramChatMemberUpdated) {
  const userId = update.from?.id;
  if (!userId) return;
  const status = update.new_chat_member.status;
  console.log("telegram_webhook_private_chat_membership", { status });
  try {
    if (status === "kicked" || status === "left") {
      await markPrivateChatBlocked(userId, update.chat.id);
    } else if (status === "member") {
      await recordPrivateChat(userId, update.chat.id, "webhook");
    }
  } catch (err) {
    console.error("telegram_webhook_private_chat_membership_failed", err instanceof Error ? err.message : "unknown_error");
  }
}

/**
 * Shared "finish a pending request" step used by both update types. Claims
 * the pending request (idempotency layer 2), independently re-verifies the
 * channel + bot admin + requesting-user admin status live against Telegram,
 * and only then persists the connection.
 */
async function resolvePendingAgainstChat(
  pending: PendingChannelRequestRecord,
  telegramChatId: string,
  telegramUserId: number,
  req: NextRequest,
  source: "chat_shared" | "my_chat_member",
  observedChatId: number | null = null
) {
  if (pending.status !== "pending") {
    console.log("telegram_webhook_pending_already_resolved", { pendingId: pending.id, source });
    return;
  }

  const claimed = await claimPendingRequestForProcessing(pending.id);
  if (!claimed) {
    console.log("telegram_webhook_pending_claim_lost", { pendingId: pending.id, source });
    return;
  }

  console.log("telegram_webhook_verifying_channel", { pendingId: pending.id, source });
  const verification = await verifyChannelOwnershipAndBotAccess(telegramChatId, telegramUserId);
  if (!verification.ok) {
    console.log("telegram_webhook_verification_failed", { pendingId: pending.id, reason: verification.reason, source });
    await updatePendingChannelRequestById(pending.id, {
      status: "failed",
      failureReason: verification.reason,
    });
    await notifyIfBotMethod(pending, () => notifyBotConnectionFailure(telegramUserId, verification.reason, observedChatId));
    return;
  }

  // Session creation for brand-new accounts is deferred to
  // /api/channels/connect-status, which is the only place that can
  // actually deliver the resulting cookie to the browser — see
  // FinalizeOptions in src/lib/channelConnection.ts for why.
  const finalized = await finalizeVerifiedChannelConnection(verification, pending.identity, req.headers.get("user-agent"), {
    createSessionForNewAccount: false,
  });
  if (!finalized.ok) {
    console.error("telegram_webhook_finalize_failed", { pendingId: pending.id, error: finalized.error, source });
    await updatePendingChannelRequestById(pending.id, {
      status: "failed",
      failureReason: "telegram_api_error",
    });
    await notifyIfBotMethod(pending, () => notifyBotConnectionFailure(telegramUserId, "telegram_api_error", observedChatId));
    return;
  }

  console.log("telegram_webhook_connection_persisted", {
    pendingId: pending.id,
    channelId: finalized.result.channel.id,
    source,
  });
  await updatePendingChannelRequestById(pending.id, {
    status: "verified",
    resolvedChannelId: finalized.result.channel.id,
    resolvedUserId: finalized.result.userId,
    isNewAccount: finalized.result.isNewAccount,
  });
  await notifyIfBotMethod(pending, () => notifyBotConnectionSuccess(telegramUserId, finalized.result.channel.channelName, observedChatId));
}

/** Notification failures (e.g. user blocked the bot) must never affect the verified outcome. */
async function safeNotify(fn: () => Promise<void>) {
  try {
    await fn();
  } catch (err) {
    console.error("telegram_webhook_bot_notify_failed", err instanceof Error ? err.message : "unknown_error");
  }
}

/** In-chat confirmation is sent ONLY for bot-chat fallback requests; Direct Picker requests are untouched. */
async function notifyIfBotMethod(pending: PendingChannelRequestRecord, fn: () => Promise<void>) {
  if (connectMethodForRequestId(pending.telegramRequestId) !== "bot") return;
  await safeNotify(fn);
}
