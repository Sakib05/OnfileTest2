import { and, desc, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { botChannelAdminEvents } from "@/db/schema";

/**
 * Durable store for Telegram `my_chat_member` updates about Onfile's own
 * bot — i.e. "the bot's membership/admin status in channel X changed,
 * performed by Telegram user Y". This is the only Bot-API-backed signal that
 * can answer "which channel did this authenticated person just add our bot
 * to as administrator", which Manual Connect needs because the Bot API
 * cannot resolve an arbitrary pasted invite link into a chat (see
 * src/lib/telegramBot.ts and src/lib/inviteLink.ts).
 *
 * Nothing read from here is ever treated as sufficient proof by itself —
 * every connection attempt independently re-verifies bot admin status (and
 * the requesting user's admin status) live against the Telegram Bot API
 * immediately before persisting a `channels` row. This store only narrows
 * down *which* chat id to re-verify.
 */

export interface BotChannelAdminEventInput {
  telegramChatId: string;
  telegramUserId: string;
  chatTitle?: string | null;
  chatUsername?: string | null;
  isChannel: boolean;
  botStatus: string;
  canPostMessages?: boolean | null;
}

/** Upserts the latest known state for a given Telegram chat (one row per chat). */
export async function recordBotChannelAdminEvent(event: BotChannelAdminEventInput): Promise<void> {
  await db
    .insert(botChannelAdminEvents)
    .values({
      telegramChatId: event.telegramChatId,
      telegramUserId: event.telegramUserId,
      chatTitle: event.chatTitle ?? null,
      chatUsername: event.chatUsername ?? null,
      isChannel: event.isChannel,
      botStatus: event.botStatus,
      canPostMessages: event.canPostMessages ?? null,
    })
    .onConflictDoUpdate({
      target: botChannelAdminEvents.telegramChatId,
      set: {
        telegramUserId: event.telegramUserId,
        chatTitle: event.chatTitle ?? null,
        chatUsername: event.chatUsername ?? null,
        isChannel: event.isChannel,
        botStatus: event.botStatus,
        canPostMessages: event.canPostMessages ?? null,
        updatedAt: new Date(),
      },
    });
}

export interface BotChannelAdminDiscovery {
  telegramChatId: string;
  telegramUserId: string;
  chatTitle: string | null;
  chatUsername: string | null;
  updatedAt: Date;
}

/**
 * Finds the most recent channel where `telegramUserId` added our bot as an
 * administrator, within `withinMs` of now. Used by Manual Connect
 * (src/app/api/channels/connect-manual/route.ts) to discover which channel
 * a pasted invite link should correspond to. The result is only ever a
 * starting point for a fresh live Telegram Bot API re-verification — never
 * persisted as a connection on its own.
 */
export async function findRecentAdminDiscoveryForUser(
  telegramUserId: number,
  withinMs: number
): Promise<BotChannelAdminDiscovery | undefined> {
  const cutoff = new Date(Date.now() - withinMs);
  const [row] = await db
    .select()
    .from(botChannelAdminEvents)
    .where(
      and(
        eq(botChannelAdminEvents.telegramUserId, String(telegramUserId)),
        eq(botChannelAdminEvents.botStatus, "administrator"),
        eq(botChannelAdminEvents.isChannel, true),
        gt(botChannelAdminEvents.updatedAt, cutoff)
      )
    )
    .orderBy(desc(botChannelAdminEvents.updatedAt))
    .limit(1);
  if (!row) return undefined;
  return {
    telegramChatId: row.telegramChatId,
    telegramUserId: row.telegramUserId,
    chatTitle: row.chatTitle,
    chatUsername: row.chatUsername,
    updatedAt: row.updatedAt,
  };
}
