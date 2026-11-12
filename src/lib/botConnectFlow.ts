import crypto from "crypto";
import {
  getLatestPendingBotRequestForUser,
  lookupPendingForBotStart,
  type PendingChannelRequestRecord,
} from "@/lib/pendingChannelRequests";
import { buildChannelPickerKeyboard, sendBotMessage } from "@/lib/telegramBot";
import { CHANNEL_FAILURE_MESSAGES } from "@/lib/channelConnection";

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
 *   2. The Mini App opens that link — Telegram opens the Onfile bot chat.
 *      Telegram's own START button / auto-send delivers `/start <payload>`.
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

async function sendPickerKeyboard(chatId: number, pending: PendingChannelRequestRecord) {
  const res = await sendBotMessage(chatId, readyMessage(pending), buildChannelPickerKeyboard(pending.telegramRequestId));
  if (!res.ok) {
    console.error("bot_connect_send_keyboard_failed", { description: res.description, errorCode: res.errorCode });
  }
  return res;
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

export async function notifyBotConnectionSuccess(telegramUserId: number, channelTitle?: string | null) {
  const name = channelTitle ? `“${channelTitle}”` : "Your channel";
  await sendBotMessage(
    telegramUserId,
    `✅ ${name} is now connected to your Onfile account.\n\nReturn to Onfile — it updates automatically.`,
    REMOVE_KEYBOARD
  );
}

export async function notifyBotConnectionFailure(telegramUserId: number, reason: string) {
  const detail = CHANNEL_FAILURE_MESSAGES[reason] ?? "We couldn’t connect that channel.";
  await sendBotMessage(telegramUserId, `❌ ${detail}\n\n${RETRY_HINT}`, REMOVE_KEYBOARD);
}

export async function notifyBotRequestExpired(telegramUserId: number) {
  await sendBotMessage(telegramUserId, BOT_MESSAGES.expiredOnSelection, REMOVE_KEYBOARD);
}
