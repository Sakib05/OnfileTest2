import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { botPrivateChats } from "@/db/schema";

/**
 * Storage for the verified private chat between the Onfile bot and a Telegram
 * user (see the `bot_private_chats` table in src/db/schema.ts).
 *
 * Trust model — the chat id is ONLY ever written from:
 *   1. a webhook update (authenticated by `TELEGRAM_WEBHOOK_SECRET`) whose
 *      `message.chat.type` / `my_chat_member.chat.type` is `private`, keyed by
 *      that update's `from.id`; or
 *   2. Telegram's own answer to a `getChat` probe for the authenticated user
 *      (legacy backfill, see probePrivateChat in src/lib/telegramBot.ts).
 * It is never accepted from the browser. A Telegram user id and a private chat
 * id are stored side by side and never treated as interchangeable.
 */

export type PrivateChatStatus = "active" | "blocked";
export type PrivateChatSource = "webhook" | "get_chat";

export interface PrivateChatRecord {
  telegramUserId: string;
  chatId: string;
  status: PrivateChatStatus;
  source: PrivateChatSource;
}

function toRecord(row: typeof botPrivateChats.$inferSelect): PrivateChatRecord {
  return {
    telegramUserId: row.telegramUserId,
    chatId: row.chatId,
    status: row.status === "blocked" ? "blocked" : "active",
    source: row.source === "get_chat" ? "get_chat" : "webhook",
  };
}

/** The stored private chat for a Telegram user, or null if none is known. */
export async function getPrivateChat(telegramUserId: number | string): Promise<PrivateChatRecord | null> {
  const [row] = await db
    .select()
    .from(botPrivateChats)
    .where(eq(botPrivateChats.telegramUserId, String(telegramUserId)))
    .limit(1);
  return row ? toRecord(row) : null;
}

/** Upserts (user → private chat) as ACTIVE and refreshes `last_seen_at`. */
export async function recordPrivateChat(
  telegramUserId: number | string,
  chatId: number | string,
  source: PrivateChatSource = "webhook"
): Promise<void> {
  const now = new Date();
  await db
    .insert(botPrivateChats)
    .values({ telegramUserId: String(telegramUserId), chatId: String(chatId), status: "active", source, lastSeenAt: now })
    .onConflictDoUpdate({
      target: botPrivateChats.telegramUserId,
      set: { chatId: String(chatId), status: "active", source, lastSeenAt: now, updatedAt: now },
    });
}

/**
 * Marks the stored chat blocked (user blocked / stopped the bot). Scoped to
 * the chat id so a stale update can't clobber a different, newer association.
 */
export async function markPrivateChatBlocked(telegramUserId: number | string, chatId: number | string): Promise<void> {
  await db
    .update(botPrivateChats)
    .set({ status: "blocked", updatedAt: new Date() })
    .where(and(eq(botPrivateChats.telegramUserId, String(telegramUserId)), eq(botPrivateChats.chatId, String(chatId))));
}

/** Forgets an association Telegram reported as invalid ("chat not found"). */
export async function removePrivateChat(telegramUserId: number | string, chatId: number | string): Promise<void> {
  await db
    .delete(botPrivateChats)
    .where(and(eq(botPrivateChats.telegramUserId, String(telegramUserId)), eq(botPrivateChats.chatId, String(chatId))));
}
