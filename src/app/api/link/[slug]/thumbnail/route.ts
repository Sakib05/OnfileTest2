import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { files } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { getClientIp } from "@/lib/rateLimit";
import { sharedRateLimit } from "@/lib/storage/sharedRateLimit";
import { canAccessThumbnail, deliverThumbnail } from "@/lib/storage/thumbnails";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Public smart-link thumbnail. Allowed ONLY for published files (same rule as
 * /api/link/[slug]); the owner may additionally view their own unpublished file.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(slug)) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const limited = await sharedRateLimit(`thumb-public:${getClientIp(req)}`, 240, 60);
    if (!limited.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

    const [file] = await db
      .select({ id: files.id, userId: files.userId, isPublished: files.isPublished })
      .from(files)
      .where(eq(files.smartLinkSlug, slug))
      .limit(1);
    if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const viewer = file.isPublished ? null : await getSessionUser(req);
    if (!canAccessThumbnail(file, viewer?.id ?? null)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return await deliverThumbnail(file.id);
  } catch (err) {
    console.error("public_thumbnail_failed", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
