import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { playlists } from "@/db/schema";
import { getSessionUser, unauthorized } from "@/lib/auth";
import { parsePositiveId } from "@/lib/playlists";
import { isValidTimeZone, resolveRange } from "@/lib/playlistAnalyticsRange";
import { firstActivityDate, getPlaylistAnalytics, localToday } from "@/lib/playlistAnalytics";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" } as const;

type Ctx = { params: Promise<{ id: string }> };

/**
 * Owner-only, server-aggregated analytics for ONE playlist (Views · Downloads · Earnings).
 *
 * Security: the session user must own the playlist (checked here, from the database — the id in the URL is never
 * trusted). A playlist that doesn't exist and one owned by somebody else both answer with the same 404. Only
 * aggregated numbers come back: no raw events, visitor hashes, Telegram ids/links, file ids or share tokens.
 *
 * Query: ?range=7d|30d|90d|all|custom  [&from=YYYY-MM-DD&to=YYYY-MM-DD]  &tz=<IANA timezone>
 */
export async function GET(req: NextRequest, { params }: Ctx) {
  try {
    const user = await getSessionUser(req);
    if (!user) return unauthorized();

    const playlistId = parsePositiveId((await params).id);
    if (!playlistId) return NextResponse.json({ error: "Invalid playlist id" }, { status: 400, headers: NO_STORE });

    const [owned] = await db
      .select({ id: playlists.id, title: playlists.title })
      .from(playlists)
      .where(and(eq(playlists.id, playlistId), eq(playlists.userId, user.id)))
      .limit(1);
    if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });

    const sp = new URL(req.url).searchParams;
    const tzParam = sp.get("tz");
    if (tzParam && !isValidTimeZone(tzParam)) return NextResponse.json({ error: "Unknown timezone" }, { status: 400, headers: NO_STORE });
    const tz = tzParam || "UTC";

    const today = await localToday(tz);
    const requestedRange = sp.get("range");
    const first = requestedRange === "all" ? await firstActivityDate(playlistId, tz) : null;
    const range = resolveRange({ range: requestedRange, from: sp.get("from"), to: sp.get("to") }, today, first);
    if (!range.ok) return NextResponse.json({ error: range.error }, { status: 400, headers: NO_STORE });

    const data = await getPlaylistAnalytics(playlistId, range, tz);

    return NextResponse.json(
      {
        playlist: { id: owned.id, title: owned.title },
        range: { key: range.key, from: range.from, to: range.to, days: range.days, granularity: range.granularity, timezone: tz, today },
        views: data.views,
        downloads: data.downloads,
        // Honest by design: no per-playlist revenue records exist (no ad-revenue ledger, no Stars payments), so nothing is
        // shown as earnings. The UI renders this explanation instead of a number.
        earnings: {
          available: false,
          currency: null,
          message: "Playlist-level earnings aren't available yet. Onfile doesn't record revenue per playlist, so no amount is shown rather than an estimate.",
        },
        series: data.series,
        insights: data.insights,
      },
      { headers: NO_STORE }
    );
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
