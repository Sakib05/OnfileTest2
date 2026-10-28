import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { playlists } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { getSessionUser, isSameOriginRequest, unauthorized } from "@/lib/auth";
import { hashAccessPassword } from "@/lib/password";

export async function GET(req: NextRequest) {
  try {
    const user = await getSessionUser(req);
    if (!user) return unauthorized();

    const result = await db
      .select()
      .from(playlists)
      .where(eq(playlists.userId, user.id))
      .orderBy(desc(playlists.createdAt));

    return NextResponse.json({ playlists: result });
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

    const body = await req.json();

    const [playlist] = await db
      .insert(playlists)
      .values({
        userId: user.id,
        title: body.title || "Untitled Playlist",
        description: body.description,
        password: body.password ? hashAccessPassword(String(body.password)) : null,
        starsPrice: body.starsPrice ? parseInt(body.starsPrice) : 0,
        isPublished: true,
      })
      .returning();

    return NextResponse.json({ playlist }, { status: 201 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
