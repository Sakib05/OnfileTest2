import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { files, playlistFiles, playlists } from "@/db/schema";
import { getSessionUser, unauthorized } from "@/lib/auth";
import { parsePositiveId } from "@/lib/playlists";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Owner-only, read-only metrics for the Creator playlist page.
 *
 * ONLY counters the existing system really records are returned:
 *  - `fileRequests`: sum of `files.downloads` over the playlist's files. That counter is incremented by
 *    `POST /api/link/:slug` when a visitor passes a file's unlock check — i.e. a file REQUEST. It is not a
 *    confirmed Telegram delivery, so it is deliberately NOT named "downloads" here.
 *
 * Nothing here is estimated. Playlist views, confirmed deliveries and earnings are not recorded per playlist
 * by the current backend (`playlists.total_views/total_downloads` and `files.views/earnings` are never written),
 * so they are intentionally absent rather than faked.
 */
export async function GET(req: NextRequest, { params }: Ctx) {
  try {
    const user = await getSessionUser(req);
    if (!user) return unauthorized();

    const playlistId = parsePositiveId((await params).id);
    if (!playlistId) return NextResponse.json({ error: "Invalid playlist id" }, { status: 400 });

    const [owned] = await db
      .select({ id: playlists.id })
      .from(playlists)
      .where(and(eq(playlists.id, playlistId), eq(playlists.userId, user.id)))
      .limit(1);
    if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const [row] = await db
      .select({ fileRequests: sql<number>`coalesce(sum(${files.downloads}), 0)::int` })
      .from(playlistFiles)
      .innerJoin(files, eq(files.id, playlistFiles.fileId))
      .where(and(eq(playlistFiles.playlistId, playlistId), eq(files.userId, user.id)));

    return NextResponse.json({ stats: { fileRequests: Number(row?.fileRequests ?? 0) } }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
