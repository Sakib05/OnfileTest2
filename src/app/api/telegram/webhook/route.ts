import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { channels, telegramUpdateLog } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getOwnBotId } from "@/lib/telegramBot";
import { notifyUser } from "@/lib/notifications";
import { connectMethodForRequestId, lookupPendingForBotStart, recordChannelSelection } from "@/lib/pendingChannelRequests";
import { recordBotChannelAdminEvent } from "@/lib/botChannelEvents";
import { getPrivateChat, markPrivateChatBlocked, recordPrivateChat } from "@/lib/botPrivateChats";
import { handleBotTextMessage, notifyBotRequestExpired, sendChannelVerificationPrompt } from "@/lib/botConnectFlow";

/** Constant-time comparison of the webhook secret header. */
function secretsMatch(provided: string, expected: string): boolean {
  const a = crypto.createHash("sha256").update(provided).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

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
 * Receives Telegram Bot API updates for the Channel Connection flows:
 *
 *   - `chat_shared` (nested in `message`): Telegram's confirmation that a user picked a channel via the native
 *     `request_chat` picker. Telegram itself has just posted its own "You shared … with Onfile" service message.
 *     This handler does the MINIMUM and returns promptly: it stores the shared channel id against the matching
 *     pending request (one atomic, guarded UPDATE that also validates user / request id / expiry) and
 *     immediately sends the "🔐 Channel Verification" message with the Verify button. It performs NO channel
 *     verification (privacy, ownership, admin rights, bot permissions) and connects NOTHING.
 *   - `my_chat_member`: fired whenever OUR BOT's own membership/admin status changes in any chat. Used to
 *     record the latest known membership (Manual Connect's discovery lookup), keep the private user → chat
 *     association current and tell owners the bot lost access. It never resolves or finalizes a pending request.
 *
 * Verification and finalization happen ONLY when the user taps Verify and the Mini App calls
 * POST /api/channels/connect-verify (src/lib/connectVerification.ts). No webhook path can connect a channel.
 *
 * Idempotent at two layers:
 *   1. Telegram `update_id`s are logged in `telegram_update_log`; a redelivered update is detected and skipped
 *      before any processing happens.
 *   2. The Verify message is reserved atomically per request (`confirmation_sent_at`), so even if the update
 *      were processed twice (e.g. the log write failed) the user still gets exactly one message.
 * This route always responds 200 so Telegram does not endlessly retry delivery for application-level failures
 * that a retry can't fix.
 *
 * Requires `TELEGRAM_WEBHOOK_SECRET` to be configured and the webhook to be registered with Telegram (via
 * `setWebhook`, including the matching `secret_token` AND `allowed_updates` containing at least `"message"` and
 * `"my_chat_member"` — see scripts/configure-telegram-webhook.mjs) outside of this code — that one-time setup is
 * a deployment step, not something this route can perform for itself.
 */
export async function POST(req: NextRequest) {
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (expectedSecret) {
    const providedSecret = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
    if (!secretsMatch(providedSecret, expectedSecret)) {
      console.error("telegram_webhook_rejected", { reason: "bad_secret_token" });
      return NextResponse.json({ ok: false }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    // Behaviour is unchanged (so a live bot keeps working), but this is the ONE thing that
    // proves an update really comes from Telegram: set TELEGRAM_WEBHOOK_SECRET and re-run
    // scripts/configure-telegram-webhook.mjs.
    console.error("telegram_webhook_unauthenticated", { reason: "TELEGRAM_WEBHOOK_SECRET_not_configured" });
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

    if (update.my_chat_member) {
      await handleMyChatMember(update.my_chat_member);
      return NextResponse.json({ ok: true });
    }

    // Fast path: the channel-sharing update. Nothing is read or written before the Verify message goes out
    // except what is strictly needed (see handleChatShared); the private-chat bookkeeping runs alongside it.
    if (update.message?.chat_shared && update.message.from?.id) {
      await handleChatShared(update.message.chat_shared, update.message.from.id, update.message.chat, update.message);
      return NextResponse.json({ ok: true });
    }

    // Remember the verified private chat (user id → chat id) so the backend can
    // later message the user in their EXISTING conversation without a "/start".
    // Only trusted, secret-authenticated webhook updates reach this point.
    // Whether this is the user's first contact is read BEFORE recording, so /start can tell new users
    // (creator welcome) from returning users (no repeated onboarding).
    const isFirstContact = update.message ? await recordPrivateChatFromMessage(update.message) : undefined;

    // Bot-chat fallback ("Connect channel via bot"): `/start <payload>` and
    // `/connect` in a private chat. Never touches `channels` directly — see
    // src/lib/botConnectFlow.ts.
    if (update.message?.text && update.message.from?.id) {
      await handleBotTextMessage({
        chatId: update.message.chat.id,
        chatType: update.message.chat.type,
        fromId: update.message.from.id,
        text: update.message.text,
        isFirstContact,
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

/**
 * Handles Telegram's `chat_shared` confirmation: store the selection, then send the Verify message at once.
 *
 * Deliberately minimal — see the route doc. In order:
 *   1. ONE atomic UPDATE (recordChannelSelection) finds the pending request for (this Telegram user, this
 *      request id), checks it is still pending / unclaimed / unexpired / started, and saves the channel id.
 *      That is the only validation needed to safely associate this update with that request; the channel itself
 *      is NOT inspected here.
 *   2. The Verify message is sent straight to the private chat the update arrived in (no lookup, no probe),
 *      once per request. The private-chat bookkeeping runs concurrently with step 1 instead of before it.
 * Never verifies, never writes to `channels`, never resolves the request.
 */
async function handleChatShared(
  chatShared: TelegramChatShared,
  telegramUserId: number,
  messageChat: { id: number; type: string },
  message: NonNullable<TelegramUpdate["message"]>
) {
  if (!Number.isInteger(chatShared.request_id) || typeof chatShared.chat_id !== "number" || !Number.isFinite(chatShared.chat_id)) {
    console.log("telegram_webhook_chat_shared_malformed", { telegramUserId });
    return;
  }
  // `chat_shared` is delivered inside the user's private chat with the bot — the chat Telegram says it came
  // from is where the Verify message is sent.
  const observedChatId = messageChat.type === "private" ? messageChat.id : null;

  const [selected] = await Promise.all([
    recordChannelSelection(telegramUserId, chatShared.request_id, String(chatShared.chat_id)),
    recordPrivateChatQuietly(message),
  ]);

  if (!selected) {
    console.log("telegram_webhook_chat_shared_no_pending_request", {
      telegramUserId,
      requestId: chatShared.request_id,
    });
    // Only for the bot-chat flow: the user is looking at the bot chat, so tell them (rather than staying
    // silent) that their request expired. A selection from the wrong user, or for an unknown/already-resolved
    // request, is ignored silently; only a genuine expiry is announced.
    if (connectMethodForRequestId(chatShared.request_id) === "bot") {
      const lookup = await lookupPendingForBotStart(telegramUserId, chatShared.request_id);
      if (lookup.kind === "expired") {
        await safeNotify(() => notifyBotRequestExpired(telegramUserId, observedChatId));
      }
    }
    return;
  }

  console.log("telegram_webhook_chat_shared_stored", { pendingId: selected.id });

  // The Mini App's Verify action is bot-chat specific: a legacy Direct Picker request has the Mini App open
  // in the foreground and verifies from there, so no chat message is sent for it.
  if (connectMethodForRequestId(selected.telegramRequestId) !== "bot") {
    console.log("telegram_webhook_in_chat_notification_skipped", { pendingId: selected.id, reason: "direct_picker_request" });
    return;
  }
  if (observedChatId === null) {
    console.error("telegram_webhook_chat_shared_no_private_chat", { pendingId: selected.id });
    return;
  }
  await safeNotify(async () => {
    const outcome = await sendChannelVerificationPrompt(telegramUserId, observedChatId, {
      id: selected.id,
      telegramRequestId: selected.telegramRequestId,
    });
    console.log("telegram_webhook_verification_prompt", { pendingId: selected.id, ...outcome });
  });
}

/**
 * Handles a `my_chat_member` update about our own bot. Records the latest known membership state (used by
 * Manual Connect's discovery lookup) and tells the owner of a connected channel when the bot lost access.
 * It deliberately does NOT complete a pending "Connect channel via bot" request: the bot becoming an
 * administrator is not the user tapping Verify, and a connection is only ever finalized by
 * POST /api/channels/connect-verify.
 */
async function handleMyChatMember(update: TelegramChatMemberUpdated) {
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

  // The bot lost admin rights in a channel: tell the owner of an active connection.
  if (isChannel && update.new_chat_member.status !== "administrator") {
    await notifyBotLostAccess(String(update.chat.id), update.new_chat_member.status, update.chat.title);
  }
}

/**
 * Records (user → private chat) from any update of a human user's message in a private chat.
 * Returns true when no private chat was on file for this user before this update (first contact),
 * false when one was, and undefined when that can't be determined (non-private chat, lookup error).
 */
async function recordPrivateChatFromMessage(message: NonNullable<TelegramUpdate["message"]>): Promise<boolean | undefined> {
  if (message.chat.type !== "private" || !message.from?.id || message.from.is_bot) return undefined;
  let isFirstContact: boolean | undefined;
  try {
    isFirstContact = (await getPrivateChat(message.from.id)) === null;
  } catch (err) {
    console.error("telegram_webhook_first_contact_lookup_failed", err instanceof Error ? err.message : "unknown_error");
  }
  try {
    await recordPrivateChat(message.from.id, message.chat.id, "webhook");
  } catch (err) {
    // Never block processing of the update itself (e.g. table not migrated yet).
    console.error("telegram_webhook_record_private_chat_failed", err instanceof Error ? err.message : "unknown_error");
  }
  return isFirstContact;
}

/** Same bookkeeping as recordPrivateChatFromMessage minus the first-contact read (not needed for `chat_shared`). */
async function recordPrivateChatQuietly(message: NonNullable<TelegramUpdate["message"]>): Promise<void> {
  if (message.chat.type !== "private" || !message.from?.id || message.from.is_bot) return;
  try {
    await recordPrivateChat(message.from.id, message.chat.id, "webhook");
  } catch (err) {
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
 * Genuine backend event: Telegram reports that the Onfile bot is no longer an
 * administrator of a channel that is currently connected to an account
 * (removed, kicked, or demoted). The connection will not work until the
 * creator re-adds the bot, so the owner is told. Never throws.
 */
async function notifyBotLostAccess(telegramChatId: string, botStatus: string, channelTitle: string | undefined) {
  try {
    const [channel] = await db
      .select()
      .from(channels)
      .where(and(eq(channels.telegramChannelId, telegramChatId), eq(channels.status, "verified")))
      .limit(1);
    if (!channel) return;
    const name = channel.channelName?.trim() || channelTitle?.trim() || "Your channel";
    await notifyUser({
      userId: channel.userId,
      type: "channel_attention",
      title: "Channel needs attention",
      body: `The Onfile bot is no longer an administrator of ${name}. Add it back as an admin so publishing keeps working.`,
      destination: { type: "channels", ref: channel.id },
      dedupeKey: `channel_attention:${channel.id}:${botStatus}:${Math.floor(Date.now() / 60_000)}`,
    });
  } catch (err) {
    console.error("telegram_webhook_bot_lost_access_notify_failed", err instanceof Error ? err.message : "unknown_error");
  }
}

/** Notification failures (e.g. user blocked the bot) must never affect the verified outcome. */
async function safeNotify(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (err) {
    console.error("telegram_webhook_bot_notify_failed", err instanceof Error ? err.message : "unknown_error");
  }
}
