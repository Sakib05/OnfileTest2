import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { adCampaigns, channels, files, playlistFiles, playlists } from "@/db/schema";
import { buildThumbnailUrl } from "@/lib/thumbnails/config";
import { getThumbnailsForFiles } from "@/lib/thumbnails/repo";
import type { DestinationDeps } from "./destination";
import { sweepExpiredCampaigns } from "./events";
import { botCanVerifyMembership, lookupChat } from "./telegram";
import { serializeCampaign, type CampaignRow } from "./serialize";

/** Real (database + Telegram) implementation of the destination dependencies. Every lookup is scoped by owner. */
export const dbDestinationDeps: DestinationDeps = {
  async getOwnedFile(userId, id) {
    const [r] = await db
      .select({ id: files.id, title: files.title, description: files.description, smartLinkSlug: files.smartLinkSlug, isPublished: files.isPublished })
      .from(files)
      .where(and(eq(files.id, id), eq(files.userId, userId)))
      .limit(1);
    return r ?? null;
  },
  async getOwnedPlaylist(userId, id) {
    const [r] = await db
      .select({ id: playlists.id, title: playlists.title, description: playlists.description, shareSlug: playlists.shareSlug, isPublished: playlists.isPublished })
      .from(playlists)
      .where(and(eq(playlists.id, id), eq(playlists.userId, userId)))
      .limit(1);
    return r ?? null;
  },
  async getOwnedChannel(userId, id) {
    const [r] = await db
      .select({ id: channels.id, telegramChannelId: channels.telegramChannelId, channelName: channels.channelName, channelUsername: channels.channelUsername, status: channels.status })
      .from(channels)
      .where(and(eq(channels.id, id), eq(channels.userId, userId)))
      .limit(1);
    return r ?? null;
  },
  async listVerifiedChannels(userId) {
    return db
      .select({ id: channels.id, telegramChannelId: channels.telegramChannelId })
      .from(channels)
      .where(and(eq(channels.userId, userId), eq(channels.status, "verified")));
  },
  lookupChat: (identifier) => lookupChat(identifier),
  botCanVerifyMembership: (chatId) => botCanVerifyMembership(chatId),
};

/** Thumbnail URLs for campaigns that promote Onfile content (resolved from the CURRENT thumbnail, never stored). */
export async function thumbnailsFor(rows: CampaignRow[]): Promise<Map<number, string | null>> {
  const out = new Map<number, string | null>();
  const fileByCampaign = new Map<number, number>();

  const playlistIds = [...new Set(rows.filter((r) => r.playlistId).map((r) => r.playlistId as number))];
  const firstFileByPlaylist = new Map<number, number>();
  if (playlistIds.length > 0) {
    const members = await db
      .select({ playlistId: playlistFiles.playlistId, fileId: playlistFiles.fileId })
      .from(playlistFiles)
      .where(inArray(playlistFiles.playlistId, playlistIds))
      .orderBy(asc(playlistFiles.position));
    for (const m of members) if (!firstFileByPlaylist.has(m.playlistId)) firstFileByPlaylist.set(m.playlistId, m.fileId);
  }
  for (const r of rows) {
    const fid = r.fileId ?? (r.playlistId ? firstFileByPlaylist.get(r.playlistId) : undefined);
    if (fid) fileByCampaign.set(r.id, fid);
  }
  const fileIds = [...new Set(fileByCampaign.values())];
  const thumbs = fileIds.length > 0 ? await getThumbnailsForFiles(fileIds) : new Map();
  for (const r of rows) {
    const fid = fileByCampaign.get(r.id);
    const t = fid ? thumbs.get(fid) : undefined;
    out.set(r.id, t ? buildThumbnailUrl(t.objectKey) : null);
  }
  return out;
}

export async function serializeMany(rows: CampaignRow[]) {
  const thumbs = await thumbnailsFor(rows);
  return rows.map((r) => serializeCampaign(r, { thumbnailUrl: thumbs.get(r.id) ?? null }));
}

/** The creator's OWN campaigns — the user id always comes from the session, never from the request. */
export async function listCreatorCampaigns(userId: number): Promise<CampaignRow[]> {
  await sweepExpiredCampaigns();
  return db.select().from(adCampaigns).where(eq(adCampaigns.userId, userId)).orderBy(desc(adCampaigns.createdAt)).limit(500);
}

/** Ownership-scoped lookup: another creator's reference is indistinguishable from a missing one. */
export async function getCreatorCampaign(userId: number, ref: string): Promise<CampaignRow | null> {
  await sweepExpiredCampaigns();
  const [row] = await db
    .select()
    .from(adCampaigns)
    .where(and(eq(adCampaigns.publicId, ref), eq(adCampaigns.userId, userId)))
    .limit(1);
  return row ?? null;
}

export interface Analytics {
  hasData: boolean;
  daily: { date: string; impressions: number; clicks: number }[];
  byPlacement: { placement: string; impressions: number; clicks: number }[];
}

/** Real recorded events only. Empty when nothing has happened yet — never simulated. */
export async function loadAnalytics(campaignId: number): Promise<Analytics> {
  const daily = await db.execute<{ d: string; impressions: string; clicks: string }>(sql`
    SELECT to_char(created_at, 'YYYY-MM-DD') AS d,
           COUNT(*) FILTER (WHERE event_type = 'impression') AS impressions,
           COUNT(*) FILTER (WHERE event_type = 'click') AS clicks
      FROM ad_events
     WHERE campaign_id = ${campaignId} AND created_at > now() - interval '30 days'
     GROUP BY 1 ORDER BY 1`);
  const byPlacement = await db.execute<{ placement: string; impressions: string; clicks: string }>(sql`
    SELECT COALESCE(placement, 'unknown') AS placement,
           COUNT(*) FILTER (WHERE event_type = 'impression') AS impressions,
           COUNT(*) FILTER (WHERE event_type = 'click') AS clicks
      FROM ad_events WHERE campaign_id = ${campaignId} GROUP BY 1 ORDER BY 2 DESC`);
  const d = daily.rows.map((r) => ({ date: r.d, impressions: Number(r.impressions), clicks: Number(r.clicks) }));
  const p = byPlacement.rows.map((r) => ({ placement: r.placement, impressions: Number(r.impressions), clicks: Number(r.clicks) }));
  return { hasData: d.length > 0, daily: d, byPlacement: p };
}
