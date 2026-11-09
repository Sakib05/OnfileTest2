import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { files, playlists } from "@/db/schema";
import { getSessionUser, isSameOriginRequest, unauthorized } from "@/lib/auth";
import { hashAccessPassword } from "@/lib/password";
import { PLAYLIST_DESCRIPTION_MAX, PLAYLIST_TITLE_MAX, parsePositiveId, validatePlaylistInput } from "@/lib/playlists";
import { toPublicPlaylist } from "@/lib/playlistView";
import { STARS_MAX } from "@/lib/publishing/constants";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(req: NextRequest, { params }: Ctx) {
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  try {
    const user = await getSessionUser(req);
    if (!user) return unauthorized();

    const playlistId = parsePositiveId((await params).id);
    if (!playlistId) return NextResponse.json({ error: "Invalid playlist id" }, { status: 400 });

    // Deleting a playlist must NEVER delete the posts inside it: they are
    // detached (playlist_id -> NULL) in the same transaction, so no post is left
    // pointing at a playlist that no longer exists.
    const deleted = await db.transaction(async (tx) => {
      const [pl] = await tx
        .select({ id: playlists.id })
        .from(playlists)
        .where(and(eq(playlists.id, playlistId), eq(playlists.userId, user.id)))
        .for("update");
      if (!pl) return null;
      await tx.update(files).set({ playlistId: null }).where(and(eq(files.playlistId, playlistId), eq(files.userId, user.id)));
      await tx.delete(playlists).where(and(eq(playlists.id, playlistId), eq(playlists.userId, user.id)));
      return pl;
    });

    if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  try {
    const user = await getSessionUser(req);
    if (!user) return unauthorized();

    const playlistId = parsePositiveId((await params).id);
    if (!playlistId) return NextResponse.json({ error: "Invalid playlist id" }, { status: 400 });

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }
    if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid request body." }, { status: 400 });

    const updates: Partial<typeof playlists.$inferInsert> = {};
    const errors: Record<string, string> = {};

    if ("title" in body) {
      const t = typeof body.title === "string" ? body.title.trim() : "";
      if (!t) errors.title = "Playlist title is required.";
      else if (t.length > PLAYLIST_TITLE_MAX) errors.title = `Title must be ${PLAYLIST_TITLE_MAX} characters or fewer.`;
      else updates.title = t;
    }
    if ("description" in body) {
      if (body.description === null || body.description === "") updates.description = null;
      else if (typeof body.description !== "string" || body.description.length > PLAYLIST_DESCRIPTION_MAX) {
        errors.description = `Description must be text up to ${PLAYLIST_DESCRIPTION_MAX} characters.`;
      } else updates.description = body.description.trim() || null;
    }
    if ("password" in body) {
      if (!body.password) updates.password = null;
      else {
        // Reuse the shared validator for the password rule.
        const check = validatePlaylistInput({ title: "x", password: body.password });
        if (!check.ok && check.errors.password) errors.password = check.errors.password;
        else updates.password = hashAccessPassword(String(body.password));
      }
    }
    if ("starsPrice" in body) {
      const n = Number(body.starsPrice);
      if (!Number.isInteger(n) || n < 0 || n > STARS_MAX) errors.starsPrice = `Stars price must be a whole number from 0 to ${STARS_MAX}.`;
      else updates.starsPrice = n;
    }
    if ("isPublished" in body) {
      if (typeof body.isPublished !== "boolean") errors.isPublished = "isPublished must be true or false.";
      else updates.isPublished = body.isPublished;
    }

    if (Object.keys(errors).length > 0) {
      return NextResponse.json({ error: Object.values(errors)[0], reason: "validation_failed", fieldErrors: errors }, { status: 400 });
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
    }
    updates.updatedAt = new Date();

    const [updated] = await db
      .update(playlists)
      .set(updates)
      .where(and(eq(playlists.id, playlistId), eq(playlists.userId, user.id)))
      .returning();

    if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(files)
      .where(and(eq(files.playlistId, playlistId), eq(files.userId, user.id)));
    return NextResponse.json({ playlist: toPublicPlaylist(updated, n) });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
