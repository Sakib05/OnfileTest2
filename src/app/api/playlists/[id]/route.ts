import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { playlists } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getSessionUser, isSameOriginRequest, unauthorized } from "@/lib/auth";
import { hashAccessPassword } from "@/lib/password";

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
    const [deleted] = await db
      .delete(playlists)
      .where(and(eq(playlists.id, parseInt(id)), eq(playlists.userId, user.id)))
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
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  try {
    const user = await getSessionUser(req);
    if (!user) return unauthorized();

    const { id } = await params;
    const body = await req.json();
    const allowed = ["title", "description", "password", "starsPrice", "isPublished"];
    const updates: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in body) updates[key] = body[key];
    }
    if ("password" in updates) {
      updates.password = updates.password ? hashAccessPassword(String(updates.password)) : null;
    }
    updates["updatedAt"] = new Date();

    const [updated] = await db
      .update(playlists)
      .set(updates)
      .where(and(eq(playlists.id, parseInt(id)), eq(playlists.userId, user.id)))
      .returning();

    if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ playlist: updated });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
