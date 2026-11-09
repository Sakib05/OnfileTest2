import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { files } from "@/db/schema";
import { eq, desc, and } from "drizzle-orm";
import { getSessionUser, isSameOriginRequest, unauthorized } from "@/lib/auth";
import { publishPost } from "@/lib/publishing/publishPost";
import { dbPublishDeps } from "@/lib/publishing/publishDeps";
import { rateLimit } from "@/lib/rateLimit";
import { parsePositiveId } from "@/lib/playlists";
import { userHasVerifiedChannel } from "@/lib/channelConnection";
import { buildThumbnailUrl } from "@/lib/thumbnails/config";
import { getThumbnailsForFiles } from "@/lib/thumbnails/repo";

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
      const pid = parsePositiveId(playlistId);
      if (!pid) return NextResponse.json({ error: "Invalid playlist id" }, { status: 400 });
      conditions.push(eq(files.playlistId, pid));
    }

    const result = await db
      .select()
      .from(files)
      .where(and(...conditions))
      .orderBy(desc(files.createdAt))
      .limit(100);

    // Thumbnails are looked up separately (and never throw) so a thumbnail
    // problem can never break the library listing itself.
    const thumbs = await getThumbnailsForFiles(result.map((f) => f.id));
    const withThumbs = result.map((f) => {
      const t = thumbs.get(f.id);
      return {
        ...f,
        thumbnailUrl: t ? buildThumbnailUrl(t.objectKey) : null,
        thumbnailWidth: t?.width ?? null,
        thumbnailHeight: t?.height ?? null,
      };
    });

    return NextResponse.json({ files: withThumbs });
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

    // Publishing a file is a channel-dependent creator feature: it must be
    // independently re-checked here (not just gated by the frontend route),
    // since a previously verified channel can later be disconnected or lose
    // bot access.
    if (!(await userHasVerifiedChannel(user.id))) {
      return NextResponse.json(
        { error: "Connect and verify a private Telegram channel before publishing files.", reason: "channel_required" },
        { status: 403 }
      );
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body", reason: "validation_failed" }, { status: 400 });
    }

    // All publishing rules (link→connected-channel verification, field
    // validation, playlist ownership, paid-content gate, duplicate guard) live
    // in one server-side service shared with the step-by-step Publish flow.
    const { allowed } = rateLimit(`publish:${user.id}`, 30, 60_000);
    if (!allowed) {
      return NextResponse.json({ error: "Too many attempts. Please wait a moment.", reason: "rate_limited" }, { status: 429 });
    }
    const outcome = await publishPost(dbPublishDeps, user.id, body);
    return NextResponse.json(outcome.body, { status: outcome.status });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
