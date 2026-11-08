import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, isSameOriginRequest, unauthorized } from "@/lib/auth";
import { rateLimit } from "@/lib/rateLimit";
import { verifyPostLinkAgainstChannels } from "@/lib/channelPostVerification";
import { dbPublishDeps } from "@/lib/publishing/publishDeps";

/**
 * Step 1 of the Publish flow: "does this Telegram post link belong to the
 * channel I already connected?"
 *
 * Security notes:
 *  - Creator identity comes ONLY from the session cookie.
 *  - The connected channel(s) are read from the DB for that creator; the
 *    request body is only allowed to contain the link string. Any channel id /
 *    user id a client might add is ignored.
 *  - This endpoint is advisory UX; POST /api/files re-runs the identical check
 *    at publish time, so skipping this call grants nothing.
 */
export async function POST(req: NextRequest) {
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ error: "Invalid request origin", reason: "bad_origin" }, { status: 403 });
  }

  try {
    const user = await getSessionUser(req);
    if (!user) return unauthorized();

    const { allowed } = rateLimit(`verify-post-link:${user.id}`, 30, 60_000);
    if (!allowed) {
      return NextResponse.json(
        { error: "Too many attempts. Please wait a moment and try again.", reason: "rate_limited" },
        { status: 429 }
      );
    }

    let link: unknown;
    try {
      const body = await req.json();
      link = body && typeof body === "object" ? (body as { link?: unknown }).link : undefined;
    } catch {
      return NextResponse.json({ error: "Invalid request body", reason: "invalid_body" }, { status: 400 });
    }

    const channels = await dbPublishDeps.listVerifiedChannels(user.id);
    const result = await verifyPostLinkAgainstChannels(link, channels, dbPublishDeps.resolvePublicChat);

    if (!result.ok) {
      const reason = result.reason === "no_connected_channel" ? "channel_required" : result.reason;
      return NextResponse.json({ error: result.message, reason }, { status: result.status });
    }

    return NextResponse.json({
      verified: true,
      canonicalLink: result.post.canonicalLink,
      messageId: result.post.messageId,
      messageExistenceVerified: result.post.messageExistenceVerified,
      channel: { name: result.post.channel.name, username: result.post.channel.username },
    });
  } catch (err) {
    console.error("verify_post_link_failed", err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: "Something went wrong while verifying your link. Please try again.", reason: "server_error" },
      { status: 500 }
    );
  }
}
