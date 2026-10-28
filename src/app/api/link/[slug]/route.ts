import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { files } from "@/db/schema";
import { eq } from "drizzle-orm";
import { verifyAccessPassword } from "@/lib/password";
import { getClientIp, rateLimit } from "@/lib/rateLimit";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const [file] = await db
      .select()
      .from(files)
      .where(eq(files.smartLinkSlug, slug));

    if (!file || !file.isPublished) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    // Return safe public info (no password hash)
    return NextResponse.json({
      file: {
        id: file.id,
        title: file.title,
        description: file.description,
        fileType: file.fileType,
        fileSize: file.fileSize,
        mimeType: file.mimeType,
        starsPrice: file.starsPrice,
        hasPassword: !!file.password,
        views: file.views,
        downloads: file.downloads,
        slug: file.smartLinkSlug,
      },
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const ip = getClientIp(req);
    const { allowed } = rateLimit(`link-unlock:${ip}`, 20, 60_000);
    if (!allowed) {
      return NextResponse.json({ error: "Too many attempts. Please try again shortly." }, { status: 429 });
    }

    const { slug } = await params;
    const body = await req.json();
    const { password } = body;

    const [file] = await db
      .select()
      .from(files)
      .where(eq(files.smartLinkSlug, slug));

    if (!file || !file.isPublished) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    if (file.password && !verifyAccessPassword(typeof password === "string" ? password : "", file.password)) {
      return NextResponse.json({ error: "Wrong password" }, { status: 403 });
    }

    // Increment download count
    await db
      .update(files)
      .set({ downloads: (file.downloads ?? 0) + 1 })
      .where(eq(files.id, file.id));

    return NextResponse.json({
      success: true,
      telegramMessageLink: file.telegramMessageLink,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
