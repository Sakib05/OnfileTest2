import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { playlists } from "@/db/schema";
import { NO_STORE, guard, idParam } from "@/lib/playlistApi";
import { generateShareSlug, publicOrigin } from "@/lib/publicPlaylist";
import { buildShareUrl, sharePath } from "@/lib/playlistSharing";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Returns (creating on first use) the stable public share link of one of the caller's playlists.
 * Owner-only (session + same-origin). Idempotent: the same playlist always yields the same link.
 *
 * A link is only issued for playlists that can be viewed publicly without bypassing a rule:
 *   - private (unpublished) playlists → 409 reason "private" (the owner can publish via PATCH isPublished first),
 *   - playlists with a Stars price     → 409 reason "paid_unavailable" (no Stars payment backend yet).
 * Password-protected playlists CAN be shared: the link works, recipients must enter the password.
 */
export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const g = await guard(req, true);
    if (!g.ok) return g.res;

    const playlistId = idParam((await params).id);
    if (!playlistId) return NextResponse.json({ error: "Invalid playlist id" }, { status: 400, headers: NO_STORE });

    // Ownership is part of the query: someone else's id is indistinguishable from a missing one.
    const [row] = await db
      .select()
      .from(playlists)
      .where(and(eq(playlists.id, playlistId), eq(playlists.userId, g.user.id)))
      .limit(1);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });

    if (!row.isPublished) {
      return NextResponse.json(
        { error: "This playlist is private. Make it public to share it.", reason: "private" },
        { status: 409, headers: NO_STORE }
      );
    }
    if ((row.starsPrice ?? 0) > 0) {
      return NextResponse.json(
        { error: "Paid playlists can't be shared yet because Telegram Stars payments aren't connected.", reason: "paid_unavailable" },
        { status: 409, headers: NO_STORE }
      );
    }

    let slug = row.shareSlug;
    for (let attempt = 0; !slug && attempt < 5; attempt++) {
      const candidate = generateShareSlug();
      try {
        const [updated] = await db
          .update(playlists)
          .set({ shareSlug: candidate })
          .where(and(eq(playlists.id, playlistId), eq(playlists.userId, g.user.id), isNull(playlists.shareSlug)))
          .returning({ shareSlug: playlists.shareSlug });
        if (updated?.shareSlug) {
          slug = updated.shareSlug;
        } else {
          // A concurrent request created the token first — use theirs so the link stays stable.
          const [again] = await db.select({ s: playlists.shareSlug }).from(playlists).where(eq(playlists.id, playlistId)).limit(1);
          slug = again?.s ?? null;
        }
      } catch {
        /* unique-token collision (astronomically unlikely) → try another token */
      }
    }
    if (!slug) return NextResponse.json({ error: "Couldn't create the share link. Please try again." }, { status: 500, headers: NO_STORE });

    return NextResponse.json(
      { share: { slug, path: sharePath(slug), url: buildShareUrl(publicOrigin(req), slug), hasPassword: !!row.password } },
      { headers: NO_STORE }
    );
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
