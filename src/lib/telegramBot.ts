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
): Promise<{ ok: true; result: T } | { ok: false; description: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${TELEGRAM_API_BASE}/bot${botToken}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
      signal: controller.signal,
    });
    const data = (await res.json()) as TelegramApiResponse<T>;
    if (!data.ok || data.result === undefined) {
      return { ok: false, description: data.description || "Unknown Telegram API error" };
    }
    return { ok: true, result: data.result };
  } catch (err) {
    return { ok: false, description: err instanceof Error ? err.message : "network_error" };
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

export type SendChatSelectionResult =
  | { ok: true }
  | { ok: false; reason: "missing_bot_token" | "bot_not_resolved" | "cannot_message_user" | "telegram_api_error"; detail?: string };

/**
 * Sends the Telegram user a message (in their private chat with the bot)
 * containing a native `request_chat` keyboard button. Tapping it opens
 * Telegram's own "Select a chat" screen (filtered to channels the user
 * administers), followed by Telegram's own "Add bot as administrator"
 * screen if the bot isn't already an admin there with the rights below —
 * this is Telegram's documented `KeyboardButtonRequestChat` mechanism
 * (Bot API 6.5+), not a custom/simulated UI.
 *
 * Telegram bots can only message users who have already started a
 * conversation with them (a platform-wide limitation, not something this
 * code can bypass) — that failure is surfaced as `cannot_message_user` so
 * the UI can show an actionable instruction instead of a generic error.
 */
export async function sendChatSelectionPrompt(
  botToken: string,
  telegramUserId: number,
  requestId: number
): Promise<SendChatSelectionResult> {
  if (!botToken) return { ok: false, reason: "missing_bot_token" };

  const botId = await getBotId(botToken);
  if (!botId) return { ok: false, reason: "bot_not_resolved" };

  const res = await callTelegramApi<{ message_id: number }>(botToken, "sendMessage", {
    chat_id: telegramUserId,
    text: "Tap the button below to select the Telegram channel you want to connect to Onfile.",
    reply_markup: {
      keyboard: [
        [
          {
            text: "📢 Select channel to connect",
            request_chat: {
              request_id: requestId,
              chat_is_channel: true,
              bot_administrator_rights: REQUIRED_BOT_ADMIN_RIGHTS,
              request_title: true,
              request_username: true,
            },
          },
        ],
      ],
      resize_keyboard: true,
      one_time_keyboard: true,
    },
  });

  if (!res.ok) {
    const description = res.description.toLowerCase();
    if (description.includes("bot can't initiate conversation") || description.includes("chat not found")) {
      return { ok: false, reason: "cannot_message_user", detail: res.description };
    }
    return { ok: false, reason: "telegram_api_error", detail: res.description };
  }

  return { ok: true };
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
