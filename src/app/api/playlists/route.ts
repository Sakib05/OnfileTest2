import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { db } from "@/db";
import { files, playlists } from "@/db/schema";
import { getSessionUser, isSameOriginRequest, unauthorized } from "@/lib/auth";
import { hashAccessPassword } from "@/lib/password";
import { userHasVerifiedChannel } from "@/lib/channelConnection";
import { validatePlaylistInput } from "@/lib/playlists";
import { toPublicPlaylist } from "@/lib/playlistView";

export const dynamic = "force-dynamic";

// Namespace for the per-user advisory lock that serialises playlist creation.
const PLAYLIST_LOCK_NAMESPACE = 7042;
// A second request for the same title by the same creator inside this window is
// treated as a repeated tap/retry of the first one (returns it instead of duplicating).
const DUPLICATE_WINDOW_SECONDS = 30;

export async function GET(req: NextRequest) {
  try {
    const user = await getSessionUser(req);
    if (!user) return unauthorized();

    // File counts are computed from the files table (the stored `total_files`
    // column was never maintained, so it can't be trusted).
    const rows = await db
      .select({
        playlist: playlists,
        fileCount: // Columns are written out with table names on purpose: in a single-table select
        // Drizzle renders ${col} unqualified, which would resolve to the subquery's own table.
        sql<number>`(select count(*)::int from "files" f where f."playlist_id" = "playlists"."id" and f."user_id" = "playlists"."user_id")`,
      })
      .from(playlists)
      .where(eq(playlists.userId, user.id))
      .orderBy(desc(playlists.createdAt), desc(playlists.id));

    return NextResponse.json(
      { playlists: rows.map((r) => toPublicPlaylist(r.playlist, r.fileCount)) },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  try {
    const user = await getSessionUser(req);
    if (!user) return unauthorized();

    // Creating a playlist is a channel-dependent creator feature — see
    // src/app/api/files/route.ts for why this is re-checked server-side.
    if (!(await userHasVerifiedChannel(user.id))) {
      return NextResponse.json(
        { error: "Connect and verify a private Telegram channel before creating a playlist.", reason: "channel_required" },
        { status: 403 }
      );
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const parsed = validatePlaylistInput(body);
    if (!parsed.ok) {
      const first = Object.values(parsed.errors)[0] ?? "Please check the playlist details.";
      return NextResponse.json({ error: first, reason: "validation_failed", fieldErrors: parsed.errors }, { status: 400 });
    }
    const v = parsed.value;

    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${PLAYLIST_LOCK_NAMESPACE}::int, ${user.id}::int)`);

      const [recent] = await tx
        .select()
        .from(playlists)
        .where(
          and(
            eq(playlists.userId, user.id),
            sql`lower(${playlists.title}) = lower(${v.title})`,
            gt(playlists.createdAt, sql`now() - make_interval(secs => ${DUPLICATE_WINDOW_SECONDS})`)
          )
        )
        .limit(1);
      if (recent) return { duplicate: true as const, playlist: recent };

      const [created] = await tx
        .insert(playlists)
        .values({
          userId: user.id,
          title: v.title,
          description: v.description,
          password: v.password ? hashAccessPassword(v.password) : null,
          starsPrice: v.starsPrice,
          isPublished: true,
        })
        .returning();
      return { duplicate: false as const, playlist: created };
    });

    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(files)
      .where(and(eq(files.playlistId, result.playlist.id), eq(files.userId, user.id)));

    return NextResponse.json(
      { playlist: toPublicPlaylist(result.playlist, n), duplicate: result.duplicate },
      { status: result.duplicate ? 200 : 201, headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Couldn't create the playlist. Please try again." }, { status: 500 });
  }
}
