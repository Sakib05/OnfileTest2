import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { files } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getSessionUser, isSameOriginRequest, unauthorized } from "@/lib/auth";
import { hashAccessPassword } from "@/lib/password";
import { notifyUser } from "@/lib/notifications";
import { DESCRIPTION_MAX, STARS_MAX } from "@/lib/publishing/constants";
import { parsePositiveId } from "@/lib/playlists";
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
    if (!parsePositiveId(id)) return NextResponse.json({ error: "Invalid file id" }, { status: 400 });
    let body: Record<string, unknown>;
    try {
      const parsed: unknown = await req.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("bad body");
      body = parsed as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    const allowed = ["title", "description", "category", "fileType", "password", "starsPrice", "isPublished"];
    const updates: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in body) updates[key] = body[key];
    }
    // Hardening for the owner UI (playlist page → File settings / Publish): validate the editable fields that
    // can be sent here. Only keys that are present are checked, so every existing caller keeps working.
    if ("title" in updates) {
      const t = typeof updates.title === "string" ? updates.title.trim() : "";
      if (!t || t.length > 256) return NextResponse.json({ error: "Title is required (up to 256 characters)." }, { status: 400 });
      updates.title = t;
    }
    if ("description" in updates) {
      // Library → Edit details: free text, optional. Empty clears it; whitespace-only counts as empty.
      if (updates.description !== null && typeof updates.description !== "string") {
        return NextResponse.json({ error: "Description must be text." }, { status: 400 });
      }
      const d = typeof updates.description === "string" ? updates.description.trim() : "";
      if (d.length > DESCRIPTION_MAX) {
        return NextResponse.json({ error: `Description must be ${DESCRIPTION_MAX} characters or fewer.` }, { status: 400 });
      }
      updates.description = d || null;
    }
    if ("starsPrice" in updates) {
      const n = Number(updates.starsPrice);
      if (!Number.isInteger(n) || n < 0 || n > STARS_MAX) {
        return NextResponse.json({ error: `Stars price must be a whole number from 0 to ${STARS_MAX}.` }, { status: 400 });
      }
      updates.starsPrice = n;
    }
    if ("isPublished" in updates && typeof updates.isPublished !== "boolean") {
      return NextResponse.json({ error: "isPublished must be true or false." }, { status: 400 });
    }
    if ("password" in updates) {
      if (updates.password && (typeof updates.password !== "string" || updates.password.length > 128)) {
        return NextResponse.json({ error: "Password must be text up to 128 characters." }, { status: 400 });
      }
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
    if (!parsePositiveId(id)) return NextResponse.json({ error: "Invalid file id" }, { status: 400 });
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
