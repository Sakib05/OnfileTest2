/**
 * Thin wrapper around the Telegram Bot API calls needed to verify that:
 *   1. A channel identifier supplied by a creator actually resolves to a
 *      real Telegram channel.
 *   2. Onfile's bot has been added to that channel as an administrator with
 *      the permissions required to forward/post files.
 *   3. The Telegram user who is setting up the connection (already verified
 *      via `initData`) is themselves an administrator/creator of that exact
 *      channel.
 *
 * IMPORTANT LIMITATION: Telegram's Bot API has no concept of "ownership" in
 * a legal sense. The strongest signal available to a bot is `getChatMember`
 * reporting the user's role as `creator` (channel owner) or `administrator`.
 * This code therefore proves "the authenticated Telegram user currently
 * administers this channel AND our bot currently has admin rights on it" —
 * not full, unrevocable ownership. If a creator is later removed as an
 * admin, Onfile does not automatically find out unless the channel is
 * re-verified (e.g. on reconnect, or via a future periodic recheck job,
 * which is out of scope for this stage and is called out in the report).
 */

export interface ResolvedChat {
  id: string;
  type: string;
  title?: string;
  username?: string;
}

export type ChannelVerificationFailureReason =
  | "missing_bot_token"
  | "invalid_channel"
  | "not_a_channel"
  | "channel_is_public"
  | "bot_not_in_channel"
  | "bot_not_admin"
  | "bot_missing_permissions"
  | "user_not_admin"
  | "telegram_api_error";

export type ChannelVerificationResult =
  | { ok: true; chat: ResolvedChat }
  | { ok: false; reason: ChannelVerificationFailureReason; detail?: string };

interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

interface TelegramChatMember {
  status: "creator" | "administrator" | "member" | "restricted" | "left" | "kicked";
  can_post_messages?: boolean;
  user?: { id: number };
}

interface TelegramChat {
  id: number;
  type: string;
  title?: string;
  username?: string;
}

const TELEGRAM_API_BASE = "https://api.telegram.org";
const REQUEST_TIMEOUT_MS = 8000;

async function callTelegramApi<T>(
  botToken: string,
  method: string,
  params: Record<string, unknown>
): Promise<{ ok: true; result: T } | { ok: false; description: string; httpStatus?: number; errorCode?: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${TELEGRAM_API_BASE}/bot${botToken}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
      signal: controller.signal,
    });
    let data: TelegramApiResponse<T>;
    try {
      data = (await res.json()) as TelegramApiResponse<T>;
    } catch {
      // Telegram (or a proxy in front of it) returned a non-JSON body —
      // never a bot-token leak since we never log the request body/URL.
      console.error("telegram_api_non_json_response", { method, httpStatus: res.status });
      return { ok: false, description: "non_json_response", httpStatus: res.status };
    }
    if (!data.ok || data.result === undefined) {
      const description = data.description || "Unknown Telegram API error";
      // Safe to log: Telegram's `description`/`error_code` never contain the
      // bot token, chat content, or any Onfile secret — only Telegram's own
      // human-readable API error text (e.g. "Forbidden: bot was blocked by
      // the user"). This is what lets the *next* production request reveal
      // the real failure instead of a bare 502 with empty logs.
      console.error("telegram_api_error", {
        method,
        httpStatus: res.status,
        errorCode: data.error_code,
        description,
      });
      return { ok: false, description, httpStatus: res.status, errorCode: data.error_code };
    }
    return { ok: true, result: data.result };
  } catch (err) {
    const description = err instanceof Error ? err.message : "network_error";
    const isAbort = err instanceof Error && err.name === "AbortError";
    console.error("telegram_api_network_error", {
      method,
      timedOut: isAbort,
      message: description,
    });
    return { ok: false, description: isAbort ? "request_timed_out" : description };
  } finally {
    clearTimeout(timeout);
  }
}

let cachedBotId: number | null = null;
let cachedBotUsername: string | null = null;

async function getBotId(botToken: string): Promise<number | null> {
  if (cachedBotId !== null) return cachedBotId;
  const me = await callTelegramApi<{ id: number; username?: string }>(botToken, "getMe", {});
  if (!me.ok) return null;
  cachedBotId = me.result.id;
  if (me.result.username) cachedBotUsername = me.result.username;
  return cachedBotId;
}

/** Returns the bot's @username (needed to build t.me deep links), cached after the first lookup. */
export async function getBotUsername(botToken: string): Promise<string | null> {
  if (cachedBotUsername) return cachedBotUsername;
  const me = await callTelegramApi<{ id: number; username?: string }>(botToken, "getMe", {});
  if (!me.ok || !me.result.username) return null;
  cachedBotId = me.result.id;
  cachedBotUsername = me.result.username;
  return cachedBotUsername;
}

/**
 * The exact set of administrator rights Onfile's bot needs in a connected
 * channel: permission to post messages (used to deliver/forward files).
 * Every other right is explicitly set to `false` so Telegram's native "Add
 * bot as administrator" screen never asks for — and the bot is never
 * granted — permissions Onfile doesn't use (e.g. changing channel info,
 * inviting users, or promoting other admins).
 */
export const REQUIRED_BOT_ADMIN_RIGHTS = {
  is_anonymous: false,
  can_manage_chat: false,
  can_delete_messages: false,
  can_manage_video_chats: false,
  can_restrict_members: false,
  can_promote_members: false,
  can_change_info: false,
  can_invite_users: false,
  can_post_stories: false,
  can_edit_stories: false,
  can_delete_stories: false,
  can_post_messages: true,
} as const;

/**
 * The administrator rights the *Telegram user* picking a channel must hold
 * in that channel for Telegram to treat it as a valid selection.
 *
 * Per Telegram's `KeyboardButtonRequestChat` spec: "`bot_administrator_rights`
 * ... must be a subset of `user_administrator_rights`" (and, symmetrically,
 * "`user_administrator_rights` ... must be a superset of
 * `bot_administrator_rights`"). Telegram validates this relationship on the
 * `sendMessage` call itself — if `bot_administrator_rights` requests any
 * right (here, `can_post_messages`) while `user_administrator_rights` is
 * left unset, Telegram has no evidence the requesting user is even capable
 * of granting that right, and the request to send the keyboard is rejected
 * with `400 Bad Request: USER_RIGHTS_MISSING` before the user ever sees the
 * chat-selection screen.
 *
 * Using the same rights object as `REQUIRED_BOT_ADMIN_RIGHTS` is the
 * smallest valid superset (it's trivially a superset of itself) and matches
 * Onfile's product requirement: only channels where the user already has
 * posting/admin authority should be selectable, which also mirrors the
 * independent `getChatMember`-based check in
 * `verifyChannelOwnershipAndBotAccess` below.
 */
export const REQUIRED_USER_ADMIN_RIGHTS = REQUIRED_BOT_ADMIN_RIGHTS;

export type PreparedChatRequestResult =
  | { ok: true; preparedButtonId: string }
  | { ok: false; reason: "missing_bot_token" | "bot_not_resolved" | "telegram_api_error"; detail?: string };

interface TelegramPreparedKeyboardButton {
  id: string;
}

/**
 * Direct-picker channel connection flow (Bot API 9.6+ / Telegram Mini Apps
 * `requestChat`): instead of sending the user a message in their private
 * chat with the bot containing a `request_chat` reply-keyboard button (the
 * previous flow, which required the user to first open/start a chat with
 * the bot before anything could be sent to them), Onfile now:
 *
 *   1. Calls the Bot API method `savePreparedKeyboardButton` with the exact
 *      same `KeyboardButtonRequestChat` criteria as before, scoped to the
 *      authenticated Telegram user via `user_id`. Telegram stores the
 *      button server-side and returns a `PreparedKeyboardButton.id`.
 *   2. The Mini App calls `Telegram.WebApp.requestChat(id)` directly from
 *      the user's tap on "Connect Channel" — this opens Telegram's native
 *      chat-selection screen immediately, with no bot chat and no second
 *      "Select channel to connect" tap required.
 *   3. When the user picks a chat (and, if needed, confirms adding the bot
 *      as administrator with the requested rights), Telegram delivers the
 *      exact same `chat_shared` service message to the bot's webhook as
 *      the previous flow did — so the webhook handler
 *      (src/app/api/telegram/webhook/route.ts) and the independent
 *      Telegram Bot API re-verification (verifyChannelOwnershipAndBotAccess
 *      below) are unchanged and unaffected by this change.
 *
 * `savePreparedKeyboardButton` does not message the user, so it cannot fail
 * with "bot can't initiate conversation" — the whole class of "open the bot
 * chat first" failures this previously needed to handle no longer applies.
 */
export async function createPreparedChatRequestButton(
  botToken: string,
  telegramUserId: number,
  requestId: number
): Promise<PreparedChatRequestResult> {
  if (!botToken) return { ok: false, reason: "missing_bot_token" };

  const botId = await getBotId(botToken);
  if (!botId) return { ok: false, reason: "bot_not_resolved" };

  const res = await callTelegramApi<TelegramPreparedKeyboardButton>(botToken, "savePreparedKeyboardButton", {
    user_id: telegramUserId,
    button: {
      text: "Select channel to connect",
      request_chat: {
        request_id: requestId,
        chat_is_channel: true,
        // Private-channel filter at the picker level (Part A.5): channels
        // with a public @username are excluded from Telegram's own "Select
        // a chat" screen whenever the client supports this field. This is
        // only a UX convenience — the backend independently re-verifies
        // "no public username" via `getChat` in
        // verifyChannelOwnershipAndBotAccess below regardless of what the
        // picker filtered, since a client-side filter is never trusted as
        // the security boundary.
        chat_has_username: false,
        bot_administrator_rights: REQUIRED_BOT_ADMIN_RIGHTS,
        // Required alongside `bot_administrator_rights`: Telegram rejects
        // the request with `USER_RIGHTS_MISSING` unless
        // `user_administrator_rights` is also specified as (at least) a
        // superset of it. See REQUIRED_USER_ADMIN_RIGHTS above.
        user_administrator_rights: REQUIRED_USER_ADMIN_RIGHTS,
        request_title: true,
      },
    },
  });

  if (!res.ok) {
    console.error("save_prepared_keyboard_button_failed", {
      httpStatus: res.httpStatus,
      errorCode: res.errorCode,
      detail: res.description,
    });
    return { ok: false, reason: "telegram_api_error", detail: res.description };
  }

  return { ok: true, preparedButtonId: res.result.id };
}

/**
 * Best-effort removal of the bot from a channel it no longer administers on
 * Onfile's behalf. Uses Telegram's documented `leaveChat` method. Callers
 * must only report the bot as removed when this genuinely succeeds — a
 * failure here (already removed, insufficient permission, etc.) never
 * blocks disconnecting the channel on Onfile's side, but must be reported
 * accurately rather than assumed.
 */
export async function leaveChannel(botToken: string, telegramChannelId: string): Promise<boolean> {
  const res = await callTelegramApi<boolean>(botToken, "leaveChat", { chat_id: telegramChannelId });
  return res.ok === true;
}

/** Normalizes a creator-supplied channel identifier (never trusted as-is). */
export function normalizeChannelIdentifier(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  // Accept forms: "@channel", "channel", "https://t.me/channel", or a
  // numeric -100... id. We only use this to ASK Telegram what the chat is —
  // the response from Telegram (not this parsing) is the source of truth.
  const tMeMatch = value.match(/^(?:https?:\/\/)?t\.me\/([a-zA-Z0-9_]+)\/?$/i);
  if (tMeMatch) return `@${tMeMatch[1]}`;
  if (/^-?\d+$/.test(value)) return value;
  if (/^@?[a-zA-Z0-9_]{5,32}$/.test(value)) {
    return value.startsWith("@") ? value : `@${value}`;
  }
  return null;
}

/**
 * Verifies that the bot is an admin of the given channel with permission to
 * post, AND that `telegramUserId` is an admin/creator of that same channel.
 */
export async function verifyChannelOwnershipAndBotAccess(
  channelIdentifier: string,
  telegramUserId: number
): Promise<ChannelVerificationResult> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    return { ok: false, reason: "missing_bot_token" };
  }

  const chatRes = await callTelegramApi<TelegramChat>(botToken, "getChat", {
    chat_id: channelIdentifier,
  });
  if (!chatRes.ok) {
    return { ok: false, reason: "invalid_channel", detail: chatRes.description };
  }
  const chat = chatRes.result;
  if (chat.type !== "channel") {
    return { ok: false, reason: "not_a_channel" };
  }

  // Onfile's product requirement is that only PRIVATE channels can be
  // connected (see master prompt / FAQ: private-channel requirement). The
  // Bot API's `getChat` only returns a `username` for channels that have a
  // public @handle (i.e. anyone can join via t.me/<username> without an
  // invite link); channels without a public username are private. This is
  // the only reliable signal the Bot API exposes for "public vs private",
  // so it is checked independently of how the identifier was supplied
  // (manual link/username OR Telegram's native chat-selection flow) —
  // neither path can bypass this check.
  if (chat.username) {
    return { ok: false, reason: "channel_is_public" };
  }

  const botId = await getBotId(botToken);
  if (!botId) {
    return { ok: false, reason: "telegram_api_error", detail: "could_not_resolve_bot_identity" };
  }

  const botMemberRes = await callTelegramApi<TelegramChatMember>(botToken, "getChatMember", {
    chat_id: chat.id,
    user_id: botId,
  });
  if (!botMemberRes.ok) {
    return { ok: false, reason: "bot_not_in_channel", detail: botMemberRes.description };
  }
  if (botMemberRes.result.status !== "administrator" && botMemberRes.result.status !== "creator") {
    return { ok: false, reason: "bot_not_admin" };
  }
  if (botMemberRes.result.status === "administrator" && botMemberRes.result.can_post_messages === false) {
    return { ok: false, reason: "bot_missing_permissions" };
  }

  const userMemberRes = await callTelegramApi<TelegramChatMember>(botToken, "getChatMember", {
    chat_id: chat.id,
    user_id: telegramUserId,
  });
  if (!userMemberRes.ok) {
    return { ok: false, reason: "user_not_admin", detail: userMemberRes.description };
  }
  if (userMemberRes.result.status !== "administrator" && userMemberRes.result.status !== "creator") {
    return { ok: false, reason: "user_not_admin" };
  }

  return {
    ok: true,
    chat: {
      id: String(chat.id),
      type: chat.type,
      title: chat.title,
      username: chat.username,
    },
  };
}
