import { NextRequest } from "next/server";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { channels, files, playlistFiles, playlists } from "@/db/schema";
import { buildThumbnailUrl } from "@/lib/thumbnails/config";
import { getThumbnailsForFiles } from "@/lib/thumbnails/repo";
import { guardCreator, json, apiError } from "@/lib/ads/http";
import { AD_TYPE_INFO, LANGUAGE_OPTIONS, COUNTRY_OPTIONS, LIMITS, OBJECTIVE_INFO, OBJECTIVES_BY_TYPE, PLACEMENTS, PRICING_NOTICE } from "@/lib/ads/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/advertise/options — what the wizard may offer THIS creator: their own promotable content and channels. */
export async function GET(req: NextRequest) {
  const g = await guardCreator(req, { mutating: false, bucket: "options", limit: 40 });
  if ("response" in g) return g.response;
  const uid = g.user.id;
  try {
    const fileRows = await db
      .select({ id: files.id, title: files.title, fileType: files.fileType, isPublished: files.isPublished, slug: files.smartLinkSlug })
      .from(files)
      .where(eq(files.userId, uid))
      .orderBy(desc(files.createdAt))
      .limit(200);
    const playlistRows = await db
      .select({ id: playlists.id, title: playlists.title, isPublished: playlists.isPublished, shareSlug: playlists.shareSlug, totalFiles: playlists.totalFiles })
      .from(playlists)
      .where(eq(playlists.userId, uid))
      .orderBy(desc(playlists.createdAt))
      .limit(100);
    const channelRows = await db
      .select({ id: channels.id, name: channels.channelName, username: channels.channelUsername, botIsAdmin: channels.botIsAdmin })
      .from(channels)
      .where(and(eq(channels.userId, uid), eq(channels.status, "verified")));

    const firstFile = new Map<number, number>();
    if (playlistRows.length > 0) {
      const members = await db
        .select({ playlistId: playlistFiles.playlistId, fileId: playlistFiles.fileId })
        .from(playlistFiles)
        .where(inArray(playlistFiles.playlistId, playlistRows.map((p) => p.id)))
        .orderBy(asc(playlistFiles.position));
      for (const m of members) if (!firstFile.has(m.playlistId)) firstFile.set(m.playlistId, m.fileId);
    }
    const thumbs = await getThumbnailsForFiles([...new Set([...fileRows.map((f) => f.id), ...firstFile.values()])]);
    const thumbUrl = (fid: number | undefined) => {
      const t = fid ? thumbs.get(fid) : undefined;
      return t ? buildThumbnailUrl(t.objectKey) : null;
    };

    return json({
      files: fileRows.map((f) => ({
        id: f.id,
        title: f.title,
        fileType: f.fileType,
        thumbnailUrl: thumbUrl(f.id),
        eligible: !!f.isPublished && !!f.slug,
        reason: f.isPublished && f.slug ? null : "Publish this file first.",
      })),
      playlists: playlistRows.map((p) => ({
        id: p.id,
        title: p.title,
        totalFiles: p.totalFiles ?? 0,
        thumbnailUrl: thumbUrl(firstFile.get(p.id)),
        eligible: !!p.isPublished && !!p.shareSlug,
        reason: p.isPublished && p.shareSlug ? null : "Share and publish this playlist first.",
      })),
      channels: channelRows.map((c) => ({
        id: c.id,
        name: c.name ?? "Channel",
        username: c.username,
        isPrivate: !c.username,
        botIsAdmin: !!c.botIsAdmin,
      })),
      adTypes: AD_TYPE_INFO,
      objectivesByType: OBJECTIVES_BY_TYPE,
      objectives: OBJECTIVE_INFO,
      placements: PLACEMENTS,
      countries: COUNTRY_OPTIONS,
      languages: LANGUAGE_OPTIONS,
      limits: LIMITS,
      pricing: { status: "pending_admin_confirmation", notice: PRICING_NOTICE },
    });
  } catch (e) {
    console.error("advertise_options_failed", e instanceof Error ? e.message : e);
    return apiError("Couldn't load your content.", 500);
  }
}
