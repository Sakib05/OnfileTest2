import { and, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/db";
import { channels, files, playlists } from "@/db/schema";
import { hashAccessPassword } from "@/lib/password";
import { resolvePublicChatId } from "@/lib/telegramBot";
import { parseTelegramPostLink, postIdentityKey } from "@/lib/telegramPostLink";
import { isPaidPublishingAvailable } from "./payments";
import type { PublishDeps } from "./publishPost";

// Namespace for the per-user advisory lock that serializes publishing.
const PUBLISH_LOCK_NAMESPACE = 7041;

/** Database-backed dependencies for `publishPost`. */
export const dbPublishDeps: PublishDeps = {
  async listVerifiedChannels(userId) {
    return db
      .select({
        id: channels.id,
        telegramChannelId: channels.telegramChannelId,
        channelName: channels.channelName,
        channelUsername: channels.channelUsername,
      })
      .from(channels)
      .where(and(eq(channels.userId, userId), eq(channels.status, "verified")));
  },

  async playlistBelongsToUser(playlistId, userId) {
    const [row] = await db
      .select({ id: playlists.id })
      .from(playlists)
      .where(and(eq(playlists.id, playlistId), eq(playlists.userId, userId)))
      .limit(1);
    return !!row;
  },

  resolvePublicChat: resolvePublicChatId,

  async insertUnlessDuplicate(record) {
    return db.transaction(async (tx) => {
      // Serialize concurrent publishes by the same creator (double-tap,
      // retries, two tabs) so the duplicate check below cannot race.
      await tx.execute(sql`select pg_advisory_xact_lock(${PUBLISH_LOCK_NAMESPACE}::int, ${record.userId}::int)`);

      const existing = await tx
        .select({ link: files.telegramMessageLink })
        .from(files)
        .where(eq(files.userId, record.userId));
      for (const row of existing) {
        // Legacy rows may hold any pasted form; compare by parsed post identity.
        const parsed = parseTelegramPostLink(row.link);
        if (parsed.ok && postIdentityKey(parsed.link) === record.postKey) return { status: "duplicate" as const };
      }

      const [file] = await tx
        .insert(files)
        .values({
          userId: record.userId,
          title: record.title,
          description: record.description,
          category: record.category,
          fileType: record.fileType as (typeof files.$inferInsert)["fileType"],
          telegramMessageLink: record.telegramMessageLink,
          playlistId: record.playlistId,
          password: record.password ? hashAccessPassword(record.password) : null,
          starsPrice: record.starsPrice,
          smartLinkSlug: nanoid(10),
          isPublished: record.isPublished,
        })
        .returning();
      return { status: "created" as const, file };
    });
  },

  paidPublishingAvailable: isPaidPublishingAvailable,
};
