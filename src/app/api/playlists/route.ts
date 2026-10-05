import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { playlists } from "@/db/schema";
import { eq, desc } from "drizzle-orm";

export async function GET(req: NextRequest) {
  try {
    const userId = req.cookies.get("onfile_user_id")?.value;
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const result = await db
      .select()
      .from(playlists)
      .where(eq(playlists.userId, parseInt(userId)))
      .orderBy(desc(playlists.createdAt));

    return NextResponse.json({ playlists: result });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = req.cookies.get("onfile_user_id")?.value;
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();

    const [playlist] = await db
      .insert(playlists)
      .values({
        userId: parseInt(userId),
        title: body.title || "Untitled Playlist",
        description: body.description,
        password: body.password || null,
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
