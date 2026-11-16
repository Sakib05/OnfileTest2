import crypto from "crypto";
import {
  claimConfirmationDelivery,
  getLatestPendingBotRequestForUser,
  lookupPendingForBotStart,
  markPickerSent,
  releaseConfirmationDelivery,
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
 *   4. Telegram posts its own "You shared … with Onfile" service message, and the
 *      `chat_shared` update reaches the webhook. The webhook ONLY stores the selected channel
 *      against the pending request and immediately sends the "Channel Verification" message
 *      with the Verify button (sendChannelVerificationPrompt). It performs NO channel
 *      verification and connects nothing.
 *   5. The Verify button opens the Mini App, whose Verify action calls
 *      POST /api/channels/connect-verify — the ONLY place where the live Bot API
 *      verification (privacy, owner/admin rights, bot admin + permissions) runs and the
 *      connection is finalized (src/lib/connectVerification.ts).
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

const CREATOR_WELCOME_MESSAGE =
  "👋 Welcome to Onfile!\n\n" +
  "Your Content. Your Audience. Your Earnings.\n\n" +
  "You already create and share valuable content with your audience. Why not earn from it too?\n\n" +
  "Onfile helps Telegram channel owners turn their files into an earning opportunity.\n\n" +
  "💰 Monetize Your Content — Earn revenue from your shared files through Onfile's monetization system.\n\n" +
  "📂 Share Without Limits — Share files with your audience through a seamless file-sharing experience.\n\n" +
  "📈 Grow Your Earnings — Turn your audience's interest in your content into potential income.\n\n" +
  "🎯 Stay in Control — Your channel, your content, your audience. You remain the owner.\n\n" +
  "Don't just share files. Make your content work for you.\n\n" +
  "Welcome to Onfile — where content creates opportunities.";

const RETRY_HINT = "Return to Onfile and tap “Start”, then “Connect” to try again.";

export const BOT_MESSAGES = {
  /**
   * Creator-focused introduction shown to NEW users. Deliberately contains no setup / connection /
   * permission instructions and no mention of any button. Plain text (sent without `parse_mode`),
   * so there is no markup to get wrong and nothing user-controlled to escape.
   * Copy is the exact text approved by the product owner — see docs/BOT_WELCOME_AND_CONFIRMATION.md
   * for the product-claims audit of the benefits listed here.
   */
  welcome: CREATOR_WELCOME_MESSAGE,
  /** No longer sent: an ordinary /start now gets `welcome` for every user. Kept only for reference/tests. */
  welcomeBack: "👋 Welcome back to Onfile!\n\nOpen the Onfile app any time to pick up where you left off.",
  noActiveRequest:
    "I don’t have an active channel connection request for you. Open Onfile, open “Connect channel via bot” and tap “Start”, then “Connect”.",
  notConnecting:
    "Almost there! Return to Onfile and tap “Connect” first — then this chat will show the channel selection button.",
  invalidLink: "This connection link isn’t valid for your account. " + RETRY_HINT,
  expired: "This connection request has expired. " + RETRY_HINT,
  alreadyUsed: "This connection request was already used. If you still need to connect a channel, open Onfile and start again.",
  expiredOnSelection:
    "That channel selection arrived after the request expired, so nothing was connected. " + RETRY_HINT,
} as const;

/**
 * Exact, product-approved copy of the Channel Selection message (the message that carries the native
 * channel picker button). NOT the general welcome message. The 10-minute window is still enforced by the
 * backend (`expires_at`); it is simply no longer announced here. Static, plain text (no parse_mode).
 */
export const CHANNEL_SELECTION_MESSAGE =
  "📢 Please select the private Telegram channel you want to connect to your Onfile account.\n\n" +
  "Tap the button below to select your channel 👇";

export function channelSelectionMessage(): string {
  return CHANNEL_SELECTION_MESSAGE;
}

async function sendPickerKeyboard(chatId: number | string, pending: PendingChannelRequestRecord) {
  // Native picker: a ReplyKeyboardMarkup `request_chat` button whose request_id is THIS request's
  // Telegram request id — Telegram echoes it back in `chat_shared`, which the webhook matches on
  // (authenticated Telegram user id, request id).
  const res = await sendBotMessage(
    chatId,
    channelSelectionMessage(),
    buildChannelPickerKeyboard(pending.telegramRequestId)
  );
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
  /**
   * Set by the webhook, BEFORE it records the private chat: true = Telegram user had no private chat
   * with the bot on file (first contact), false = returning user, undefined = unknown (lookup failed
   * or caller doesn't track it). Only ever derived server-side from the authenticated webhook.
   * Only consulted for the signed `/start c1_…` flow; an ordinary `/start` ignores it (and the webhook
   * does not compute it for an ordinary `/start`).
   */
  isFirstContact?: boolean;
}

/** Parses "/cmd", "/cmd arg" and "/cmd@BotName arg". */
export function parseBotCommand(text: string): { command: string; arg: string } | null {
  const m = /^\/([a-zA-Z_]+)(?:@[A-Za-z0-9_]+)?(?:\s+(\S+))?\s*$/.exec(text.trim());
  if (!m) return null;
  return { command: m[1].toLowerCase(), arg: m[2] ?? "" };
}

/**
 * True for an ORDINARY `/start`: the command is `/start` and it carries no payload of ours (no payload at
 * all, or a payload that is not a signed `c1_…` connect payload). Such a message only ever produces the
 * static Welcome Message, so the webhook may skip all account / private-chat bookkeeping for it.
 * Deliberately uses the SAME parsing and the SAME `c1_` test as handleBotTextMessage so the two can never
 * disagree about which `/start` messages are special deep links.
 */
export function isOrdinaryStartCommand(text: string): boolean {
  const parsed = parseBotCommand(text);
  return parsed !== null && parsed.command === "start" && !parsed.arg.startsWith("c1_");
}

/**
 * Handles `/start [payload]` and `/connect` in a private chat with the bot.
 * Returns true if the message was a command this handler owns. All replies
 * are plain text; nothing here touches the `channels` table — a connection is
 * only ever finalized by the Mini App's Verify action (connectVerification.ts).
 */
export async function handleBotTextMessage(msg: BotTextMessage): Promise<boolean> {
  if (msg.chatType !== "private") return false;
  const parsed = parseBotCommand(msg.text);
  if (!parsed) return false;

  if (parsed.command === "start") {
    // Only payloads of our own shape are ours; anything else (no payload, or
    // some other deep-link feature) gets the neutral welcome.
    if (!parsed.arg || !parsed.arg.startsWith("c1_")) {
      // Ordinary /start (see isOrdinaryStartCommand): EVERY user — new or returning — gets the same
      // approved Welcome Message, so nothing about the user is looked up first. Just one sendMessage.
      await sendBotMessage(msg.chatId, BOT_MESSAGES.welcome);
      return true;
    }

    // First-time activation through the signed Start link: introduce Onfile first, then continue
    // with the unchanged connection flow below. A failed welcome never blocks the picker.
    if (msg.isFirstContact === true) {
      await sendBotMessage(msg.chatId, BOT_MESSAGES.welcome);
    }

    const verified = verifyBotStartPayload(parsed.arg, msg.fromId);
    if (!verified.ok) {
      console.log("bot_connect_start_rejected", { reason: verified.reason });
      await sendBotMessage(msg.chatId, BOT_MESSAGES.invalidLink);
      return true;
    }

    const lookup = await lookupPendingForBotStart(msg.fromId, verified.requestId);
    switch (lookup.kind) {
      case "ok": {
        const sent = await sendPickerKeyboard(msg.chatId, lookup.pending);
        if (sent.ok) await markPickerSent(lookup.pending.id);
        break;
      }
      case "not_connecting":
        await sendBotMessage(msg.chatId, BOT_MESSAGES.notConnecting);
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

// ─── "Channel Verification" (second bot message) ─────────────────────────────

/** The one variable the operator must set. Everything else is a convenience fallback. */
export const MINI_APP_URL_ENV = "MINI_APP_URL";

/**
 * Env sources for the Mini App origin, in precedence order. Only values an operator (or Vercel's stable
 * PRODUCTION domain) put there on purpose are accepted:
 *   - MINI_APP_URL                    explicit, preferred.
 *   - NEXT_PUBLIC_APP_URL             explicit public app origin.
 *   - VERCEL_PROJECT_PRODUCTION_URL   Vercel system variable; trusted ONLY when VERCEL_ENV === "production".
 * `VERCEL_URL` is deliberately NOT used: it is the per-deployment hostname (not the Mini App URL registered with
 * BotFather) and is usually behind Vercel Deployment Protection, so a button pointing at it would open a login wall.
 */
const MINI_APP_URL_SOURCES = ["MINI_APP_URL", "NEXT_PUBLIC_APP_URL", "VERCEL_PROJECT_PRODUCTION_URL"] as const;

export type MiniAppUrlResolution =
  | { ok: true; baseUrl: string; source: (typeof MINI_APP_URL_SOURCES)[number] }
  | { ok: false; /** Variables that were set but unusable (not https / not a URL). */ invalid: string[] };

/**
 * Public https base URL of the Mini App, used ONLY to build the `web_app` button. Telegram only accepts https URLs
 * for `web_app` buttons, so anything else is rejected (and reported in `invalid`) — never "fixed up" or guessed.
 */
export function resolveMiniAppBaseUrl(env: NodeJS.ProcessEnv = process.env): MiniAppUrlResolution {
  const invalid: string[] = [];
  for (const name of MINI_APP_URL_SOURCES) {
    const value = env[name]?.trim();
    if (!value) continue;
    if (name === "VERCEL_PROJECT_PRODUCTION_URL" && env.VERCEL_ENV !== "production") continue;
    // Vercel system variables hold a bare host (no scheme); an explicit scheme must be https.
    const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
    try {
      const url = new URL(withScheme);
      if (url.protocol !== "https:" || url.username || url.password) {
        invalid.push(name);
        continue;
      }
      return { ok: true, baseUrl: `${url.origin}${url.pathname.replace(/\/+$/, "")}`, source: name };
    } catch {
      invalid.push(name);
    }
  }
  return { ok: false, invalid };
}

export function getMiniAppBaseUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const resolved = resolveMiniAppBaseUrl(env);
  return resolved.ok ? resolved.baseUrl : null;
}

/**
 * The URL behind the "Verify" button. It carries ONLY the public request
 * reference (`connect=<Telegram request id>`): no token, no secret, no
 * Telegram/chat/channel id and no channel title. The Mini App resolves it
 * server-side against the authenticated Telegram user (GET
 * /api/channels/connect-status?ref=), so the ref is meaningless to anyone else.
 * It is the SAME launch URL the previous "Return to Onfile" button used — the
 * existing request is verified, never a new one created. Where the Mini App
 * navigates afterwards (the Dashboard) is decided client-side, only after the
 * server has confirmed the connection.
 */
export function buildVerifyUrl(telegramRequestId: number, env: NodeJS.ProcessEnv = process.env): string | null {
  const base = getMiniAppBaseUrl(env);
  if (!base) return null;
  return `${base}/?connect=${telegramRequestId}`;
}

/** Exact label of the inline Web App button below the verification message. */
export const VERIFY_BUTTON_TEXT = "Verify";

export function buildVerifyKeyboard(telegramRequestId: number, env: NodeJS.ProcessEnv = process.env) {
  const url = buildVerifyUrl(telegramRequestId, env);
  if (!url) return undefined;
  return { inline_keyboard: [[{ text: VERIFY_BUTTON_TEXT, web_app: { url } }]] };
}

/**
 * Exact, product-approved copy of the second bot message. Static on purpose: it does NOT interpolate the channel
 * title (that would conflict with the approved copy, and the title is user-controlled text), so there is nothing
 * client-supplied that could reach it.
 */
export const CHANNEL_VERIFICATION_MESSAGE =
  "🔐 Channel Verification\n\n" +
  "🚀 Tap the button below to verify your connection.";

export function channelVerificationMessage(): string {
  return CHANNEL_VERIFICATION_MESSAGE;
}

export type VerificationPromptResult =
  | { delivered: true; buttonAttached: boolean }
  | { delivered: false; reason: "duplicate" | "send_failed" | "bot_blocked" };

/**
 * Sends the "🔐 Channel Verification" message (+ inline `web_app` button "Verify") — IMMEDIATELY after the
 * webhook stored the `chat_shared` selection. Nothing has been verified and nothing is connected at this
 * point: the message only invites the user to open the Mini App, which performs the real verification.
 *
 * Speed: `chatId` is the private chat the `chat_shared` update itself arrived in, so there is no database
 * lookup and no `getChat` probe before sending. The only work before the Bot API call is the single atomic
 * `confirmation_sent_at` reservation.
 *
 * Sent at most ONCE per request (that atomic reservation), so a retried / duplicated webhook update can
 * never produce a second message. Plain text (no parse_mode); it names no channel, so no user-controlled
 * title can reach it.
 *
 * Nothing here fails silently:
 *   - no https Mini App URL          → `bot_connect_verify_button_unavailable` (error) naming the exact env variable;
 *                                      the message is still sent, without a button (never a plain URL button)
 *   - Telegram rejects the keyboard  → `bot_connect_verify_button_rejected` (error) + the text-only message is sent
 *                                      (only for HTTP 400: a deterministic rejection, so no duplicate is possible)
 *   - Telegram rejects the message   → `bot_connect_verification_prompt_failed` (error); when Telegram DEFINITIVELY
 *                                      answered with an error the reservation is released so a re-selection retries.
 *                                      An ambiguous network failure keeps it (the message may have been delivered).
 */
export async function sendChannelVerificationPrompt(
  telegramUserId: number,
  chatId: number | string,
  pending: { id: number; telegramRequestId: number }
): Promise<VerificationPromptResult> {
  const pendingId = pending.id;
  const keyboard = buildVerifyKeyboard(pending.telegramRequestId);
  if (!keyboard) {
    const resolution = resolveMiniAppBaseUrl();
    console.error("bot_connect_verify_button_unavailable", {
      pendingId,
      requiredEnv: MINI_APP_URL_ENV,
      example: `${MINI_APP_URL_ENV}=https://onfile-app.vercel.app`,
      acceptedAlternatives: MINI_APP_URL_SOURCES.filter((n) => n !== MINI_APP_URL_ENV),
      invalid: resolution.ok ? [] : resolution.invalid,
      reason: "no_https_mini_app_url",
    });
  }

  if (!(await claimConfirmationDelivery(pendingId))) {
    console.log("bot_connect_confirmation_duplicate_skipped", { pendingId });
    return { delivered: false, reason: "duplicate" };
  }

  const text = channelVerificationMessage();
  let res = await sendBotMessage(chatId, text, keyboard ?? REMOVE_KEYBOARD);
  let buttonAttached = Boolean(keyboard) && res.ok;
  if (!res.ok && keyboard && res.errorCode === 400) {
    console.error("bot_connect_verify_button_rejected", { pendingId, description: res.description, errorCode: res.errorCode });
    res = await sendBotMessage(chatId, text, REMOVE_KEYBOARD);
    buttonAttached = false;
  }
  if (!res.ok) {
    const blocked = classifySendFailure(res) === "bot_blocked";
    console.error("bot_connect_verification_prompt_failed", { pendingId, description: res.description, errorCode: res.errorCode });
    if (res.errorCode !== undefined) await safely("bot_connect_confirmation_release_failed", () => releaseConfirmationDelivery(pendingId));
    if (blocked) await safely("bot_connect_chat_mark_blocked_failed", () => markPrivateChatBlocked(telegramUserId, String(chatId)));
    return { delivered: false, reason: blocked ? "bot_blocked" : "send_failed" };
  }
  return { delivered: true, buttonAttached };
}

export async function notifyBotConnectionFailure(telegramUserId: number, reason: string, observedChatId?: number | string | null) {
  const detail = CHANNEL_FAILURE_MESSAGES[reason] ?? "We couldn’t connect that channel.";
  await notify(telegramUserId, observedChatId, `❌ ${detail}\n\n${RETRY_HINT}`);
}

export async function notifyBotRequestExpired(telegramUserId: number, observedChatId?: number | string | null) {
  await notify(telegramUserId, observedChatId, BOT_MESSAGES.expiredOnSelection);
}
