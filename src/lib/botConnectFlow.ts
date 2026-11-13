import crypto from "crypto";
import {
  getLatestPendingBotRequestForUser,
  lookupPendingForBotStart,
  type PendingChannelRequestRecord,
} from "@/lib/pendingChannelRequests";
import { buildChannelPickerKeyboard, probePrivateChat, sendBotMessage, type SendBotMessageResult } from "@/lib/telegramBot";
import { CHANNEL_FAILURE_MESSAGES } from "@/lib/channelConnection";
import {
  getPrivateChat,
  markPrivateChatBlocked,
  recordPrivateChat,
  removePrivateChat,
  type PrivateChatRecord,
} from "@/lib/botPrivateChats";

/**
 * "Connect channel via bot" — fallback for Telegram clients that cannot use
 * the Mini App Direct Channel Picker (`Telegram.WebApp.requestChat`, Bot API
 * 9.6+).
 *
 * Flow (see docs/BOT_CHANNEL_FALLBACK.md for the full write-up):
 *   1. The Mini App asks POST /api/channels/connect-bot-request for a bot
 *      deep link. The server creates a normal pending channel request (same
 *      table + safeguards as the Direct Picker: hashed bearer token, 10 min
 *      TTL, bound to the authenticated Telegram user) whose Telegram
 *      `request_id` is in the "bot" range, and returns
 *      `https://t.me/<bot>?start=<signed payload>`.
 *      RETURNING users (a verified private chat is on file) never get that
 *      link: the server sends the keyboard straight into their existing chat
 *      (deliverPickerKeyboardToExistingChat) and the Mini App opens the plain
 *      `https://t.me/<bot>` link, so no new "/start" is produced.
 *   2. For first-time users the Mini App opens the signed link — Telegram opens
 *      the Onfile bot chat and its own START button delivers `/start <payload>`.
 *   3. The webhook verifies the payload's signature and that the Telegram
 *      user who pressed Start is the user the request was created for, then
 *      replies with a ReplyKeyboardMarkup containing a `request_chat`
 *      (KeyboardButtonRequestChat) button — the only Bot API mechanism that
 *      opens Telegram's native channel picker from a bot chat. The criteria
 *      are the exact same ones the Direct Picker uses.
 *   4. Telegram posts a `chat_shared` service message; the existing webhook
 *      pipeline (claim → live Bot API re-verification → finalize) completes
 *      the connection, and this module tells the user the result in chat.
 */

// ─── Signed start payload ───────────────────────────────────────────────────
//
// Telegram `start` parameters are limited to 64 chars of [A-Za-z0-9_-] and
// are fully user-editable, so the payload is never trusted on its own:
//   c1_<request_id in base36>_<first 96 bits of HMAC-SHA256, hex>
// The HMAC covers the request id AND the Telegram user id the request was
// created for, under a domain-separation prefix, using the same server-side
// secret already used for setup tokens (never present in the link).

const PAYLOAD_VERSION = "c1";
const MAC_HEX_LENGTH = 24;

function getPayloadSecret(): string {
  const secret = process.env.SETUP_TOKEN_SECRET || process.env.TELEGRAM_BOT_TOKEN;
  if (!secret) throw new Error("missing_start_payload_secret");
  return secret;
}

function mac(requestId: number, telegramUserId: number): string {
  return crypto
    .createHmac("sha256", getPayloadSecret())
    .update(`onfile-bot-connect:${PAYLOAD_VERSION}:${requestId}:${telegramUserId}`)
    .digest("hex")
    .slice(0, MAC_HEX_LENGTH);
}

export function createBotStartPayload(requestId: number, telegramUserId: number): string {
  return `${PAYLOAD_VERSION}_${requestId.toString(36)}_${mac(requestId, telegramUserId)}`;
}

export type StartPayloadResult =
  | { ok: true; requestId: number }
  | { ok: false; reason: "malformed" | "bad_signature" };

export function verifyBotStartPayload(payload: string, telegramUserId: number): StartPayloadResult {
  const match = /^c1_([0-9a-z]{1,8})_([0-9a-f]{24})$/.exec(payload);
  if (!match) return { ok: false, reason: "malformed" };
  const requestId = parseInt(match[1], 36);
  if (!Number.isInteger(requestId) || requestId < 1 || requestId > 2_147_483_646) {
    return { ok: false, reason: "malformed" };
  }
  let expected: string;
  try {
    expected = mac(requestId, telegramUserId);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  const a = Buffer.from(match[2]);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: "bad_signature" };
  return { ok: true, requestId };
}

/**
 * Plain chat link for the configured bot — deliberately NO `?start=`. Opening
 * it just shows the existing conversation, so Telegram sends no "/start".
 */
export function buildBotChatLink(botUsername: string): string {
  return `https://t.me/${botUsername}`;
}

/** Builds the t.me deep link for the configured bot (never a hardcoded username). */
export function buildBotDeepLink(botUsername: string, payload: string): string {
  return `https://t.me/${botUsername}?start=${payload}`;
}

// ─── Bot chat copy ──────────────────────────────────────────────────────────

const RETRY_HINT = "Return to Onfile and tap “Connect channel via bot” to try again.";

export const BOT_MESSAGES = {
  welcome:
    "Welcome to Onfile Bot.\n\nTo connect your private Telegram channel:\n" +
    "1. Open Onfile\n2. Tap “Connect channel via bot”\n3. Come back here and tap “Select channel to connect”\n\n" +
    "I’ll only ask for permission to post messages in your private channel.",
  noActiveRequest:
    "I don’t have an active channel connection request for you. Open Onfile and tap “Connect channel via bot” to start one.",
  invalidLink: "This connection link isn’t valid for your account. " + RETRY_HINT,
  expired: "This connection request has expired. " + RETRY_HINT,
  alreadyUsed: "This connection request was already used. If you still need to connect a channel, open Onfile and start again.",
  expiredOnSelection:
    "That channel selection arrived after the request expired, so nothing was connected. " + RETRY_HINT,
} as const;

function readyMessage(pending: PendingChannelRequestRecord): string {
  const minutes = Math.max(1, Math.round((pending.expiresAt.getTime() - Date.now()) / 60_000));
  return (
    "Ready to connect your channel.\n\n" +
    "Tap “Select channel to connect” below and choose your private channel. " +
    "Telegram may ask you to add Onfile Bot as an administrator with permission to post messages — that’s the only permission needed.\n\n" +
    `This request expires in about ${minutes} min.`
  );
}

async function sendPickerKeyboard(chatId: number | string, pending: PendingChannelRequestRecord) {
  const res = await sendBotMessage(chatId, readyMessage(pending), buildChannelPickerKeyboard(pending.telegramRequestId));
  if (!res.ok) {
    console.error("bot_connect_send_keyboard_failed", { description: res.description, errorCode: res.errorCode });
  }
  return res;
}

// ─── Direct delivery to the user's EXISTING private chat ─────────────────────
//
// For users who have already started the bot, the backend sends the
// "Select channel to connect" keyboard itself (Bot API `sendMessage` to the
// verified private chat id). The Mini App then just opens the plain bot chat
// link — no `?start=` payload, so Telegram posts NO new "/start" from the user.
// Telegram only lets a bot message users who have started it, so everything
// else falls back to the signed start link (the pre-existing flow).

export type BotDeliveryFallbackReason =
  /** No verified private chat is known and Telegram reports none (user never started the bot). */
  | "no_chat"
  /** Telegram says the user blocked / stopped the bot (needs "Restart" via the start link). */
  | "bot_blocked"
  /** The stored chat id was rejected by Telegram ("chat not found"). */
  | "chat_invalid"
  /** Our own association lookup failed (e.g. table not migrated yet). */
  | "lookup_failed";

export type BotDeliveryResult =
  | { mode: "existing_chat"; chatId: string }
  | { mode: "start_link"; reason: BotDeliveryFallbackReason }
  | { mode: "error"; reason: "telegram_api_error"; detail?: string };

export type SendFailureKind = "no_chat" | "bot_blocked" | "chat_invalid" | "telegram_api_error";

/** Classifies a failed `sendMessage` to a private chat. Exported for tests. */
export function classifySendFailure(res: Extract<SendBotMessageResult, { ok: false }>): SendFailureKind {
  const desc = res.description ?? "";
  if (res.errorCode === 403) {
    // "bot can't initiate conversation with a user": the user never started the bot.
    if (/can'?t initiate conversation/i.test(desc)) return "no_chat";
    // "bot was blocked by the user", "user is deactivated", "bot was kicked…".
    return "bot_blocked";
  }
  if (res.errorCode === 400 && /chat not found|user not found|PEER_ID_INVALID/i.test(desc)) return "chat_invalid";
  return "telegram_api_error";
}

async function safely<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    console.error(label, err instanceof Error ? err.message : "unknown_error");
    return undefined;
  }
}

/**
 * Tries to deliver the channel-selection keyboard for `pending` into the
 * authenticated user's existing private chat with the bot. `telegramUserId`
 * MUST come from the server-side session/setup cookie, never from the client.
 *
 *   existing_chat → keyboard sent; the Mini App opens the plain chat link.
 *   start_link    → can't message the user directly; use the signed start link.
 *   error         → transient Telegram problem; the caller should report a
 *                   retryable error (NOT fall back, which would cause a "/start").
 */
export async function deliverPickerKeyboardToExistingChat(
  telegramUserId: number,
  pending: PendingChannelRequestRecord
): Promise<BotDeliveryResult> {
  // 1. The verified association (user id → private chat id) from webhook updates.
  let lookupFailed = false;
  let record: PrivateChatRecord | null = null;
  try {
    record = await getPrivateChat(telegramUserId);
  } catch (err) {
    lookupFailed = true;
    console.error("bot_connect_chat_lookup_failed", err instanceof Error ? err.message : "unknown_error");
  }

  // 2. Not recorded yet (e.g. started the bot before chats were recorded):
  //    let Telegram tell us whether a private chat exists. No guessing.
  if (!record) {
    const probe = await probePrivateChat(telegramUserId);
    if (!probe.ok) {
      if (probe.reason === "unavailable") return { mode: "error", reason: "telegram_api_error", detail: "probe_unavailable" };
      return { mode: "start_link", reason: lookupFailed ? "lookup_failed" : "no_chat" };
    }
    await safely("bot_connect_chat_record_failed", () => recordPrivateChat(telegramUserId, probe.chatId, "get_chat"));
    record = { telegramUserId: String(telegramUserId), chatId: probe.chatId, status: "active", source: "get_chat" };
  }

  // 3. Send. A stored-"blocked" chat is still attempted: the user may have
  //    unblocked the bot, and sendMessage is the authoritative check.
  const sent = await sendPickerKeyboard(record.chatId, pending);
  if (sent.ok) {
    if (record.status !== "active") {
      await safely("bot_connect_chat_record_failed", () => recordPrivateChat(telegramUserId, record!.chatId, record!.source));
    }
    return { mode: "existing_chat", chatId: record.chatId };
  }

  switch (classifySendFailure(sent)) {
    case "bot_blocked":
      await safely("bot_connect_chat_mark_blocked_failed", () => markPrivateChatBlocked(telegramUserId, record!.chatId));
      return { mode: "start_link", reason: "bot_blocked" };
    case "no_chat":
      await safely("bot_connect_chat_remove_failed", () => removePrivateChat(telegramUserId, record!.chatId));
      return { mode: "start_link", reason: "no_chat" };
    case "chat_invalid":
      await safely("bot_connect_chat_remove_failed", () => removePrivateChat(telegramUserId, record!.chatId));
      return { mode: "start_link", reason: "chat_invalid" };
    default:
      return { mode: "error", reason: "telegram_api_error", detail: sent.description };
  }
}

// ─── Command handling ───────────────────────────────────────────────────────

export interface BotTextMessage {
  chatId: number;
  chatType: string;
  fromId: number;
  text: string;
}

/** Parses "/cmd", "/cmd arg" and "/cmd@BotName arg". */
export function parseBotCommand(text: string): { command: string; arg: string } | null {
  const m = /^\/([a-zA-Z_]+)(?:@[A-Za-z0-9_]+)?(?:\s+(\S+))?\s*$/.exec(text.trim());
  if (!m) return null;
  return { command: m[1].toLowerCase(), arg: m[2] ?? "" };
}

/**
 * Handles `/start [payload]` and `/connect` in a private chat with the bot.
 * Returns true if the message was a command this handler owns. All replies
 * are plain text; nothing here touches the `channels` table — connection is
 * only ever finalized by the `chat_shared` pipeline after live verification.
 */
export async function handleBotTextMessage(msg: BotTextMessage): Promise<boolean> {
  if (msg.chatType !== "private") return false;
  const parsed = parseBotCommand(msg.text);
  if (!parsed) return false;

  if (parsed.command === "start") {
    // Only payloads of our own shape are ours; anything else (no payload, or
    // some other deep-link feature) gets the neutral welcome.
    if (!parsed.arg || !parsed.arg.startsWith("c1_")) {
      await sendBotMessage(msg.chatId, BOT_MESSAGES.welcome);
      return true;
    }

    const verified = verifyBotStartPayload(parsed.arg, msg.fromId);
    if (!verified.ok) {
      console.log("bot_connect_start_rejected", { reason: verified.reason });
      await sendBotMessage(msg.chatId, BOT_MESSAGES.invalidLink);
      return true;
    }

    const lookup = await lookupPendingForBotStart(msg.fromId, verified.requestId);
    switch (lookup.kind) {
      case "ok":
        await sendPickerKeyboard(msg.chatId, lookup.pending);
        break;
      case "expired":
        await sendBotMessage(msg.chatId, BOT_MESSAGES.expired);
        break;
      case "already_used":
        await sendBotMessage(msg.chatId, BOT_MESSAGES.alreadyUsed);
        break;
      case "wrong_user":
      case "unknown":
        await sendBotMessage(msg.chatId, BOT_MESSAGES.invalidLink);
        break;
    }
    return true;
  }

  if (parsed.command === "connect") {
    const pending = await getLatestPendingBotRequestForUser(msg.fromId);
    if (!pending) {
      await sendBotMessage(msg.chatId, BOT_MESSAGES.noActiveRequest);
    } else {
      await sendPickerKeyboard(msg.chatId, pending);
    }
    return true;
  }

  return false;
}

// ─── Outcome notifications (bot-method requests only) ───────────────────────

const REMOVE_KEYBOARD = { remove_keyboard: true };

/**
 * The chat to notify: the stored verified private chat for this user, else
 * the private chat the triggering update itself arrived in (`observedChatId`,
 * only ever passed by the webhook for a `private` chat). Never the user id.
 */
async function resolveNotifyChatId(telegramUserId: number, observedChatId?: number | string | null): Promise<string | null> {
  try {
    const record = await getPrivateChat(telegramUserId);
    if (record) return record.chatId;
  } catch (err) {
    console.error("bot_connect_chat_lookup_failed", err instanceof Error ? err.message : "unknown_error");
  }
  return observedChatId !== undefined && observedChatId !== null ? String(observedChatId) : null;
}

async function notify(telegramUserId: number, observedChatId: number | string | null | undefined, text: string) {
  const chatId = await resolveNotifyChatId(telegramUserId, observedChatId);
  if (!chatId) {
    console.log("bot_connect_notify_skipped", { reason: "no_private_chat" });
    return;
  }
  const res = await sendBotMessage(chatId, text, REMOVE_KEYBOARD);
  if (!res.ok && classifySendFailure(res) === "bot_blocked") {
    await safely("bot_connect_chat_mark_blocked_failed", () => markPrivateChatBlocked(telegramUserId, chatId));
  }
}

export async function notifyBotConnectionSuccess(
  telegramUserId: number,
  channelTitle?: string | null,
  observedChatId?: number | string | null
) {
  const name = channelTitle ? `“${channelTitle}”` : "Your channel";
  await notify(
    telegramUserId,
    observedChatId,
    `✅ ${name} is now connected to your Onfile account.\n\nReturn to Onfile — it updates automatically.`
  );
}

export async function notifyBotConnectionFailure(telegramUserId: number, reason: string, observedChatId?: number | string | null) {
  const detail = CHANNEL_FAILURE_MESSAGES[reason] ?? "We couldn’t connect that channel.";
  await notify(telegramUserId, observedChatId, `❌ ${detail}\n\n${RETRY_HINT}`);
}

export async function notifyBotRequestExpired(telegramUserId: number, observedChatId?: number | string | null) {
  await notify(telegramUserId, observedChatId, BOT_MESSAGES.expiredOnSelection);
}
