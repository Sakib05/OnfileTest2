import {
  parseTelegramPostLink,
  toInternalChannelId,
  POST_LINK_FAILURE_MESSAGES,
  type ParsedPostLink,
  type PostLinkFailureReason,
} from "@/lib/telegramPostLink";
import type { ResolvePublicChatIdResult } from "@/lib/telegramBot";

/**
 * Authoritative server-side check that a pasted Telegram post link belongs to
 * a channel the creator has ALREADY connected to their Onfile account.
 *
 * Inputs the caller must supply from the server (never from the client):
 *   - `connectedChannels`: the authenticated creator's own verified `channels`
 *     rows.
 *
 * What is proven:  the CHANNEL IDENTITY in the link equals a connected channel.
 * What is NOT proven: that the message id exists. Bot API has no read-only
 * "does message N exist" call, so `messageExistenceVerified` is always false;
 * a bad message id surfaces later, when the bot tries to deliver the file.
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
  | "verification_unavailable";

export interface VerifiedPost {
  link: ParsedPostLink;
  canonicalLink: string;
  messageId: number;
  channel: { id: number; name: string | null; username: string | null; telegramChannelId: string | null };
  /** Always false — see module doc. */
  messageExistenceVerified: false;
}

export type VerifyPostResult =
  | { ok: true; post: VerifiedPost }
  | { ok: false; reason: VerifyPostFailureReason; message: string; status: number };

export const VERIFY_FAILURE_MESSAGES: Record<
  "no_connected_channel" | "channel_mismatch" | "verification_unavailable",
  string
> = {
  no_connected_channel: "Connect your Telegram channel before publishing.",
  channel_mismatch: "This post does not belong to your connected Telegram channel.",
  verification_unavailable:
    "We couldn't verify this link with Telegram right now. Please try again in a moment; if it keeps failing, use the private post link (t.me/c/…) from your channel.",
};

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
      messageExistenceVerified: false,
    },
  };
}

export async function verifyPostLinkAgainstChannels(
  rawLink: unknown,
  connectedChannels: ConnectedChannelRef[],
  resolvePublicChat: PublicChatResolver
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
    return match ? toVerified(link, match) : fail("channel_mismatch", VERIFY_FAILURE_MESSAGES.channel_mismatch, 403);
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
  return match ? toVerified(link, match) : fail("channel_mismatch", VERIFY_FAILURE_MESSAGES.channel_mismatch, 403);
}
