import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { playlists } from "@/db/schema";
import { eq, and } from "drizzle-orm";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const userId = req.cookies.get("onfile_user_id")?.value;
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const [deleted] = await db
      .delete(playlists)
      .where(and(eq(playlists.id, parseInt(id)), eq(playlists.userId, parseInt(userId))))
      .returning();

    if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const userId = req.cookies.get("onfile_user_id")?.value;
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const allowed = ["title", "description", "password", "starsPrice", "isPublished"];
    const updates: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in body) updates[key] = body[key];
    }
    updates["updatedAt"] = new Date();

    const [updated] = await db
      .update(playlists)
      .set(updates)
      .where(and(eq(playlists.id, parseInt(id)), eq(playlists.userId, parseInt(userId))))
      .returning();

    if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ playlist: updated });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
