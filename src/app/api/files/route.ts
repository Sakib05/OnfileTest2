import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { files } from "@/db/schema";
import { eq, desc, and } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getSessionUser, isSameOriginRequest, unauthorized } from "@/lib/auth";
import { hashAccessPassword } from "@/lib/password";

export async function GET(req: NextRequest) {
  try {
    const user = await getSessionUser(req);
    if (!user) return unauthorized();

    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type");
    const playlistId = searchParams.get("playlistId");

    const conditions = [eq(files.userId, user.id)];
    if (type && type !== "all" && type !== "playlist") {
      conditions.push(eq(files.fileType, type as "video" | "audio" | "document" | "image" | "archive" | "other"));
    }
    if (playlistId) {
      conditions.push(eq(files.playlistId, parseInt(playlistId)));
    }

    const result = await db
      .select()
      .from(files)
      .where(and(...conditions))
      .orderBy(desc(files.createdAt))
      .limit(100);

    return NextResponse.json({ files: result });
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
    const slug = nanoid(10);

    const [file] = await db
      .insert(files)
      .values({
        userId: user.id,
        title: body.title || "Untitled",
        description: body.description,
        category: body.category,
        fileType: body.fileType || "other",
        fileSize: body.fileSize,
        mimeType: body.mimeType,
        telegramMessageLink: body.telegramMessageLink,
        playlistId: body.playlistId ? parseInt(body.playlistId) : null,
        password: body.password ? hashAccessPassword(String(body.password)) : null,
        starsPrice: body.starsPrice ? parseInt(body.starsPrice) : 0,
        smartLinkSlug: slug,
        isPublished: true,
      })
      .returning();

    return NextResponse.json({ file }, { status: 201 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
