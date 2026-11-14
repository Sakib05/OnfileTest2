import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { files } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getSessionUser, isSameOriginRequest, unauthorized } from "@/lib/auth";
import { hashAccessPassword } from "@/lib/password";
import { notifyUser } from "@/lib/notifications";
import { cleanupThumbnailObject, findThumbnailKeyForCleanup } from "@/lib/thumbnails/cleanup";

/**
 * Scoped to the authenticated owner. Public visitors use
 * `/api/link/[slug]` instead, which only exposes the fields needed to
 * render the public smart-link page.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getSessionUser(req);
    if (!user) return unauthorized();

    const { id } = await params;
    const [file] = await db
      .select()
      .from(files)
      .where(and(eq(files.id, parseInt(id)), eq(files.userId, user.id)));
    if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ file });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  try {
    const user = await getSessionUser(req);
    if (!user) return unauthorized();

    const { id } = await params;
    const body = await req.json();
    const allowed = ["title", "description", "category", "fileType", "password", "starsPrice", "isPublished"];
    const updates: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in body) updates[key] = body[key];
    }
    if ("password" in updates) {
      updates.password = updates.password ? hashAccessPassword(String(updates.password)) : null;
    }

    // Playlist membership is NOT editable here any more: a file can be in many playlists, so it is
    // managed through /api/playlists/:id/files[...] (add / remove / reorder / transfer), which
    // verify ownership of the playlist(s) and the file. A stray `playlistId` is ignored.
    updates["updatedAt"] = new Date();

    // Needed to announce a genuine draft → published transition (and nothing else).
    let wasPublished: boolean | null = null;
    if (updates.isPublished === true) {
      const [previous] = await db
        .select({ isPublished: files.isPublished })
        .from(files)
        .where(and(eq(files.id, parseInt(id)), eq(files.userId, user.id)))
        .limit(1);
      wasPublished = previous ? !!previous.isPublished : null;
    }

    const [updated] = await db
      .update(files)
      .set(updates)
      .where(and(eq(files.id, parseInt(id)), eq(files.userId, user.id)))
      .returning();

    if (!updated) return NextResponse.json({ error: "Not found or unauthorized" }, { status: 404 });
    if (wasPublished === false && updated.isPublished) {
      await notifyUser({
        userId: user.id,
        type: "file_published",
        title: "File published",
        body: `“${updated.title}” is live and ready to share.`,
        destination: { type: "file", ref: updated.id },
        dedupeKey: `file_published:${updated.id}`,
      });
    }
    return NextResponse.json({ file: updated });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  try {
    const user = await getSessionUser(req);
    if (!user) return unauthorized();

    const { id } = await params;
    // Remember the thumbnail object (if any) before the cascade removes its row.
    const thumbKey = await findThumbnailKeyForCleanup(user.id, parseInt(id));
    const [deleted] = await db
      .delete(files)
      .where(and(eq(files.id, parseInt(id)), eq(files.userId, user.id)))
      .returning();

    if (!deleted) return NextResponse.json({ error: "Not found or unauthorized" }, { status: 404 });
    // Best-effort: failures are queued as orphans, never surfaced as a delete failure.
    if (thumbKey) await cleanupThumbnailObject(thumbKey);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
