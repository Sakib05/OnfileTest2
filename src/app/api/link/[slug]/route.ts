import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { files, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { toPublicCreator } from "@/lib/profile/serialize";
import { verifyAccessPassword } from "@/lib/password";
import { getClientIp, rateLimit } from "@/lib/rateLimit";
import { buildThumbnailUrl } from "@/lib/thumbnails/config";
import { getThumbnailsForFiles } from "@/lib/thumbnails/repo";
import { getSessionUser } from "@/lib/auth";
import { evaluateGate, findActiveGate } from "@/lib/ads/gate";
import { getMembership } from "@/lib/ads/telegram";

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

    // Public creator display info only (name, @username, Telegram photo).
    // Never expose the internal user id, Telegram id, balances, or email.
    const [creator] = await db
      .select({
        firstName: users.firstName,
        displayNameCustom: users.displayNameCustom,
        username: users.username,
        avatarUrl: users.avatarUrl,
        profileImageKey: users.profileImageKey,
      })
      .from(users)
      .where(eq(users.id, file.userId));

    // Same stored thumbnail the creator sees in My Library (no second copy).
    const thumb = (await getThumbnailsForFiles([file.id])).get(file.id);

    // Return safe public info (no password hash)
    return NextResponse.json({
      // Effective display name + custom picture (priority over the Telegram photo) — see src/lib/profile.
      creator: creator ? toPublicCreator(creator) : null,
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
        thumbnailUrl: thumb ? buildThumbnailUrl(thumb.objectKey) : null,
        thumbnailWidth: thumb?.width ?? null,
        thumbnailHeight: thumb?.height ?? null,
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

    // Force Join: if a live force-join campaign gates THIS file, the viewer must be a verified channel member before
    // anything is released. Decided server-side from getChatMember; fails closed if Telegram can't answer.
    const gate = await findActiveGate(file.id);
    if (gate) {
      const viewer = await getSessionUser(req).catch(() => null);
      const verdict = await evaluateGate(file, gate, viewer, getMembership);
      if (verdict.gated && verdict.state !== "passed") {
        const message =
          verdict.state === "unavailable" ? "We couldn't check your channel membership right now. Please try again in a moment."
          : verdict.state === "login_required" ? "Open this file in Telegram to confirm your channel membership."
          : "Join the channel to unlock this file.";
        return NextResponse.json(
          { error: message, code: verdict.state === "join_required" ? "join_required" : verdict.state, gate: verdict.info },
          { status: verdict.state === "unavailable" ? 503 : 403 }
        );
      }
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
