import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, isSameOriginRequest, unauthorized } from "@/lib/auth";
import { discardStagedThumbnail } from "@/lib/thumbnails/staged";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * Discard a staged thumbnail that has NOT been published yet (creator removed or
 * replaced it). Only the owner's still-unused uploads can be removed; a thumbnail
 * already attached to a post is never deleted here.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ ref: string }> }) {
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403, headers: NO_STORE });
  }
  try {
    const user = await getSessionUser(req);
    if (!user) return unauthorized();
    const { ref } = await params;
    const result = await discardStagedThumbnail({ userId: user.id, ref });
    return NextResponse.json({ success: true, removed: result.removed }, { headers: NO_STORE });
  } catch (err) {
    console.error("thumbnail_discard_route_failed", err instanceof Error ? err.message : "unknown_error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
