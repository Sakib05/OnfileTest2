import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { files } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getSessionUser, isSameOriginRequest, unauthorized } from "@/lib/auth";
import { hashAccessPassword } from "@/lib/password";
import { toOwnerFile } from "@/lib/fileDto";
import { getThumbnailVersions, markThumbnailPendingDelete, purgeAssets } from "@/lib/storage/thumbnails";

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
    const thumbs = await getThumbnailVersions([file.id]).catch(() => new Map());
    return NextResponse.json({ file: toOwnerFile(file, thumbs.get(file.id)) });
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
    const allowed = ["title", "description", "category", "fileType", "password", "starsPrice", "playlistId", "isPublished"];
    const updates: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in body) updates[key] = body[key];
    }
    if ("password" in updates) {
      updates.password = updates.password ? hashAccessPassword(String(updates.password)) : null;
    }
    updates["updatedAt"] = new Date();

    const [updated] = await db
      .update(files)
      .set(updates)
      .where(and(eq(files.id, parseInt(id)), eq(files.userId, user.id)))
      .returning();

    if (!updated) return NextResponse.json({ error: "Not found or unauthorized" }, { status: 404 });
    const thumbs = await getThumbnailVersions([updated.id]).catch(() => new Map());
    return NextResponse.json({ file: toOwnerFile(updated, thumbs.get(updated.id)) });
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
    // Mark the file's thumbnail for remote deletion BEFORE the row disappears
    // (thumbnail_assets.file_id is SET NULL on delete, so nothing is forgotten).
    // Best-effort: a thumbnail problem must never block deleting a file.
    let pendingThumbnailIds: number[] = [];
    try {
      pendingThumbnailIds = await markThumbnailPendingDelete(parseInt(id), user.id);
    } catch {
      /* not found / tables not migrated: fall through to the original behaviour */
    }
    const [deleted] = await db
      .delete(files)
      .where(and(eq(files.id, parseInt(id)), eq(files.userId, user.id)))
      .returning();

    if (!deleted) return NextResponse.json({ error: "Not found or unauthorized" }, { status: 404 });
    if (pendingThumbnailIds.length) await purgeAssets(pendingThumbnailIds).catch(() => {});
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
