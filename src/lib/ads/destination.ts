import { validatePrivateInviteLink, INVITE_LINK_FAILURE_MESSAGES } from "@/lib/inviteLink";
import { parseTelegramPostLink, POST_LINK_FAILURE_MESSAGES, toInternalChannelId } from "@/lib/telegramPostLink";
import type { CampaignInput } from "./validation";
import type { ChatLookup } from "./telegram";

/**
 * Server-side destination resolution + ownership validation. A URL alone never proves ownership or permission:
 *   - files / playlists / connected channels are looked up BY OWNER in the database,
 *   - external channels/posts are only accepted when Telegram itself confirms the chat exists and is a public channel,
 *   - a promoted external destination is NEVER treated as "owned" — an administrator still reviews every campaign.
 * All I/O goes through `DestinationDeps`, so the logic is unit-testable without a database or Telegram.
 */
export interface DestinationDeps {
  getOwnedFile(userId: number, id: number): Promise<{ id: number; title: string; description: string | null; smartLinkSlug: string | null; isPublished: boolean | null } | null>;
  getOwnedPlaylist(userId: number, id: number): Promise<{ id: number; title: string; description: string | null; shareSlug: string | null; isPublished: boolean | null } | null>;
  getOwnedChannel(userId: number, id: number): Promise<{ id: number; telegramChannelId: string | null; channelName: string | null; channelUsername: string | null; status: string | null } | null>;
  listVerifiedChannels(userId: number): Promise<{ id: number; telegramChannelId: string | null }[]>;
  lookupChat(identifier: string): Promise<ChatLookup>;
  botCanVerifyMembership(chatId: string): Promise<"yes" | "no" | "unavailable">;
}

export interface ResolvedDestination {
  targetUrl: string;
  fileId: number | null;
  playlistId: number | null;
  channelId: number | null;
  inviteLink: string | null;
  tgChatId: string | null;
  tgChatUsername: string | null;
  tgChatTitle: string | null;
  joinVerifiable: boolean;
  /** Why verified joins aren't possible (only set for channel destinations where joinVerifiable is false). */
  joinNote: string | null;
  ownership: "own" | "external";
  /** Name shown in the preview. */
  label: string;
  suggestedDescription: string | null;
}

export type DestinationResult = { ok: true; value: ResolvedDestination } | { ok: false; field: string; error: string; status?: number };

const fail = (field: string, error: string, status = 422): DestinationResult => ({ ok: false, field, error, status });

const base = (): ResolvedDestination => ({
  targetUrl: "",
  fileId: null,
  playlistId: null,
  channelId: null,
  inviteLink: null,
  tgChatId: null,
  tgChatUsername: null,
  tgChatTitle: null,
  joinVerifiable: false,
  joinNote: null,
  ownership: "own",
  label: "",
  suggestedDescription: null,
});

const NOT_MINE = "We couldn't find that item in your account.";
const TELEGRAM_DOWN = "Telegram couldn't be reached right now. Please try again in a moment.";

export async function resolveDestination(
  input: Pick<CampaignInput, "adType" | "contentKind" | "fileId" | "playlistId" | "channelId" | "destinationRef" | "inviteLink">,
  userId: number,
  deps: DestinationDeps
): Promise<DestinationResult> {
  if (input.adType === "onfile_content") {
    if (input.contentKind === "file") {
      if (!input.fileId) return fail("fileId", "Select one of your files.");
      const file = await deps.getOwnedFile(userId, input.fileId);
      if (!file) return fail("fileId", NOT_MINE, 404);
      if (!file.isPublished || !file.smartLinkSlug) return fail("fileId", "Only published files with a link can be promoted. Publish this file first.");
      return { ok: true, value: { ...base(), targetUrl: `/f/${file.smartLinkSlug}`, fileId: file.id, label: file.title, suggestedDescription: file.description } };
    }
    if (input.contentKind === "playlist") {
      if (!input.playlistId) return fail("playlistId", "Select one of your playlists.");
      const pl = await deps.getOwnedPlaylist(userId, input.playlistId);
      if (!pl) return fail("playlistId", NOT_MINE, 404);
      if (!pl.isPublished || !pl.shareSlug) return fail("playlistId", "Only shared, published playlists can be promoted. Share this playlist first.");
      return { ok: true, value: { ...base(), targetUrl: `/p/${pl.shareSlug}`, playlistId: pl.id, label: pl.title, suggestedDescription: pl.description } };
    }
    return fail("contentKind", "Choose a file or a playlist.");
  }

  if (input.adType === "telegram_channel") {
    // A) one of the creator's own connected channels
    if (input.channelId) {
      const ch = await deps.getOwnedChannel(userId, input.channelId);
      if (!ch) return fail("channelId", NOT_MINE, 404);
      if (ch.status !== "verified" || !ch.telegramChannelId) return fail("channelId", "This channel isn't verified. Reconnect it from Channel Management first.");
      let url: string;
      let invite: string | null = null;
      if (ch.channelUsername) {
        url = `https://t.me/${ch.channelUsername}`;
      } else {
        // Connected channels are private, so people can only join through an invite link the creator controls.
        if (!input.inviteLink) return fail("inviteLink", "Paste an invite link for this private channel (t.me/+…).");
        const v = validatePrivateInviteLink(input.inviteLink);
        if (!v.ok) return fail("inviteLink", INVITE_LINK_FAILURE_MESSAGES[v.reason] ?? "That invite link isn't valid.");
        url = v.link.normalizedUrl;
        invite = v.link.normalizedUrl;
      }
      const can = await deps.botCanVerifyMembership(ch.telegramChannelId);
      return {
        ok: true,
        value: {
          ...base(),
          targetUrl: url,
          channelId: ch.id,
          inviteLink: invite,
          tgChatId: ch.telegramChannelId,
          tgChatUsername: ch.channelUsername,
          tgChatTitle: ch.channelName,
          joinVerifiable: can === "yes",
          joinNote: can === "yes" ? null : can === "no" ? "Onfile's bot is no longer an administrator of this channel, so joins can't be verified." : "Couldn't confirm the bot's access right now, so joins can't be verified.",
          ownership: "own",
          label: ch.channelName ?? "Your channel",
        },
      };
    }
    // B) another public channel
    const ref = (input.destinationRef ?? "").trim();
    const m = ref.match(/^(?:https?:\/\/)?(?:t\.me\/|telegram\.me\/)?@?([A-Za-z][A-Za-z0-9_]{4,31})\/?$/);
    if (!m) return fail("destinationRef", "Enter a public channel as @username or t.me/username.");
    const lookup = await deps.lookupChat(`@${m[1]}`);
    if (!lookup.ok) return fail("destinationRef", lookup.reason === "not_found" ? "Telegram doesn't know that channel." : TELEGRAM_DOWN, lookup.reason === "not_found" ? 422 : 503);
    if (lookup.chat.type !== "channel" || !lookup.chat.username) return fail("destinationRef", "Only public Telegram channels can be promoted this way.");
    const chatId = String(lookup.chat.id);
    const can = await deps.botCanVerifyMembership(chatId);
    return {
      ok: true,
      value: {
        ...base(),
        targetUrl: `https://t.me/${lookup.chat.username}`,
        tgChatId: chatId,
        tgChatUsername: lookup.chat.username,
        tgChatTitle: lookup.chat.title ?? lookup.chat.username,
        joinVerifiable: can === "yes",
        joinNote: can === "yes" ? null : "Onfile's bot isn't an administrator of this channel, so new joins can't be verified. Impressions and clicks are still available.",
        ownership: "external",
        label: lookup.chat.title ?? lookup.chat.username,
      },
    };
  }

  // telegram_post
  const parsed = parseTelegramPostLink(input.destinationRef);
  if (!parsed.ok) return fail("destinationRef", POST_LINK_FAILURE_MESSAGES[parsed.reason]);
  const link = parsed.link;
  if (link.kind === "private") {
    const mine = (await deps.listVerifiedChannels(userId)).some((c) => toInternalChannelId(c.telegramChannelId) === link.internalChannelId);
    return fail("destinationRef", mine ? "Posts in a private channel can only be opened by its members, so they can't be promoted to a wider audience." : "Only posts from public channels can be promoted.");
  }
  const lookup = await deps.lookupChat(`@${link.username}`);
  if (!lookup.ok) return fail("destinationRef", lookup.reason === "not_found" ? "Telegram doesn't know that channel." : TELEGRAM_DOWN, lookup.reason === "not_found" ? 422 : 503);
  if (lookup.chat.type !== "channel") return fail("destinationRef", "That link isn't a channel post.");
  const chatId = String(lookup.chat.id);
  const mine = (await deps.listVerifiedChannels(userId)).some((c) => toInternalChannelId(c.telegramChannelId) === toInternalChannelId(chatId));
  return {
    ok: true,
    value: {
      ...base(),
      targetUrl: link.canonicalLink,
      tgChatId: chatId,
      tgChatUsername: lookup.chat.username ?? link.username,
      tgChatTitle: lookup.chat.title ?? link.username,
      ownership: mine ? "own" : "external",
      label: `${lookup.chat.title ?? link.username} · post ${link.messageId}`,
    },
  };
}
