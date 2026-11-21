import {
  parseTelegramPostLink,
  toInternalChannelId,
  POST_LINK_FAILURE_MESSAGES,
  type ParsedPostLink,
  type PostLinkFailureReason,
} from "@/lib/telegramPostLink";
import type { PostExistenceResult, ResolvePublicChatIdResult } from "@/lib/telegramBot";

/**
 * Authoritative server-side check that a pasted Telegram post link belongs to
 * a channel the creator has ALREADY connected to their Onfile account.
 *
 * Inputs the caller must supply from the server (never from the client):
 *   - `connectedChannels`: the authenticated creator's own verified `channels`
 *     rows.
 *
 * What is proven:  (1) the CHANNEL IDENTITY in the link equals a connected channel,
 * and (2) the EXACT message id in the link exists in that channel and is
 * deliverable. (2) is delegated to the injected `PostExistenceChecker`
 * (production: `checkChannelPostExists` in telegramBot.ts, which asks Telegram
 * for that exact message id). Channel identity alone is NEVER treated as proof
 * that the post exists. If the checker cannot give a definite "exists" answer
 * (timeout, permission error, unexpected response) the link is REJECTED.
 *
 * Identity comparison rules:
 *   - /c/<id>/<msg> links carry the real channel id → compared with the stored
 *     `telegram_channel_id` (normalized, "-100" prefix tolerant).
 *   - public links carry only a username → the username is resolved to a chat
 *     id through Telegram and the IDs are compared. Usernames are never
 *     compared with each other. If Telegram can't answer, the result is
 *     `verification_unavailable`, never an implicit pass.
 */

export interface ConnectedChannelRef {
  id: number;
  telegramChannelId: string | null;
  channelName: string | null;
  channelUsername: string | null;
}

export type VerifyPostFailureReason =
  | PostLinkFailureReason
  | "no_connected_channel"
  | "channel_mismatch"
  | "verification_unavailable"
  | "post_not_found"
  | "post_not_copyable"
  | "bot_no_access"
  | "probe_chat_unavailable"
  | "post_verification_unavailable";

export interface VerifiedPost {
  link: ParsedPostLink;
  canonicalLink: string;
  messageId: number;
  channel: { id: number; name: string | null; username: string | null; telegramChannelId: string | null };
  /** True only when Telegram confirmed the exact message id exists. Always true for a successful result. */
  messageExistenceVerified: true;
}

export type VerifyPostResult =
  | { ok: true; post: VerifiedPost }
  | { ok: false; reason: VerifyPostFailureReason; message: string; status: number };

export const VERIFY_FAILURE_MESSAGES: Record<
  | "no_connected_channel"
  | "channel_mismatch"
  | "verification_unavailable"
  | "post_not_found"
  | "post_not_copyable"
  | "bot_no_access"
  | "probe_chat_unavailable"
  | "post_verification_unavailable",
  string
> = {
  no_connected_channel: "Connect your Telegram channel before publishing.",
  channel_mismatch: "This post does not belong to your connected Telegram channel.",
  verification_unavailable:
    "We couldn't verify this link with Telegram right now. Please try again in a moment; if it keeps failing, use the private post link (t.me/c/…) from your channel.",
  post_not_found: "Post not found. Please check the Telegram post link and try again.",
  post_not_copyable:
    "This post can't be used for file delivery (it may be a service message, or your channel restricts saving/forwarding content). Choose a post that contains your file.",
  bot_no_access:
    "Onfile couldn't access this post. Make sure the Onfile bot is still an administrator of your channel, then try again.",
  probe_chat_unavailable:
    "To confirm this post exists, Onfile needs to be able to message you. Open the Onfile bot chat in Telegram, press Start, then try again.",
  post_verification_unavailable:
    "We couldn't confirm that this post exists because Telegram didn't answer reliably. Nothing was accepted — please try again in a moment.",
};

/** HTTP status used for each existence failure. None of these is ever a success. */
const EXISTENCE_STATUS = {
  post_not_found: 404,
  post_not_copyable: 422,
  bot_no_access: 403,
  probe_chat_unavailable: 409,
  post_verification_unavailable: 503,
} as const;

/**
 * Asks Telegram whether message `messageId` exists in `chatId` (Bot-API style
 * "-100…" id of the CONNECTED channel — never a client-supplied value).
 */
export type PostExistenceChecker = (args: { chatId: string; messageId: number }) => Promise<PostExistenceResult>;

export type PublicChatResolver = (username: string) => Promise<ResolvePublicChatIdResult>;

function fail(reason: VerifyPostFailureReason, message: string, status: number): VerifyPostResult {
  return { ok: false, reason, message, status };
}

function toVerified(link: ParsedPostLink, channel: ConnectedChannelRef): VerifyPostResult {
  return {
    ok: true,
    post: {
      link,
      canonicalLink: link.canonicalLink,
      messageId: link.messageId,
      channel: {
        id: channel.id,
        name: channel.channelName,
        username: channel.channelUsername,
        telegramChannelId: channel.telegramChannelId,
      },
      messageExistenceVerified: true,
    },
  };
}

async function confirmExistence(
  link: ParsedPostLink,
  channel: ConnectedChannelRef,
  checkPostExists: PostExistenceChecker
): Promise<VerifyPostResult> {
  const internal = toInternalChannelId(channel.telegramChannelId);
  if (!internal) return fail("no_connected_channel", VERIFY_FAILURE_MESSAGES.no_connected_channel, 403);

  let outcome: PostExistenceResult;
  try {
    outcome = await checkPostExists({ chatId: `-100${internal}`, messageId: link.messageId });
  } catch {
    outcome = { ok: false, reason: "unavailable" };
  }
  // Fail closed: ONLY an explicit `ok: true` is acceptance.
  if (!outcome || outcome.ok !== true) {
    const reason = outcome && outcome.ok === false ? outcome.reason : "unavailable";
    const mapped = reason === "unavailable" ? "post_verification_unavailable" : reason;
    return fail(mapped, VERIFY_FAILURE_MESSAGES[mapped], EXISTENCE_STATUS[mapped]);
  }
  return toVerified(link, channel);
}

export async function verifyPostLinkAgainstChannels(
  rawLink: unknown,
  connectedChannels: ConnectedChannelRef[],
  resolvePublicChat: PublicChatResolver,
  checkPostExists: PostExistenceChecker
): Promise<VerifyPostResult> {
  const parsed = parseTelegramPostLink(rawLink);
  if (!parsed.ok) return fail(parsed.reason, POST_LINK_FAILURE_MESSAGES[parsed.reason], 400);

  const usable = connectedChannels.filter((c) => toInternalChannelId(c.telegramChannelId) !== null);
  if (usable.length === 0) {
    return fail("no_connected_channel", VERIFY_FAILURE_MESSAGES.no_connected_channel, 403);
  }

  const link = parsed.link;

  if (link.kind === "private") {
    const match = usable.find((c) => toInternalChannelId(c.telegramChannelId) === link.internalChannelId);
    return match
      ? confirmExistence(link, match, checkPostExists)
      : fail("channel_mismatch", VERIFY_FAILURE_MESSAGES.channel_mismatch, 403);
  }

  // Public-style link: only a username is available, so ask Telegram which
  // channel id that username belongs to and compare IDs.
  const resolved = await resolvePublicChat(link.username);
  if (!resolved.ok) {
    return resolved.reason === "not_found"
      ? fail("channel_mismatch", VERIFY_FAILURE_MESSAGES.channel_mismatch, 403)
      : fail("verification_unavailable", VERIFY_FAILURE_MESSAGES.verification_unavailable, 503);
  }
  const resolvedInternal = toInternalChannelId(resolved.id);
  const match = resolvedInternal ? usable.find((c) => toInternalChannelId(c.telegramChannelId) === resolvedInternal) : undefined;
  return match
    ? confirmExistence(link, match, checkPostExists)
    : fail("channel_mismatch", VERIFY_FAILURE_MESSAGES.channel_mismatch, 403);
}
