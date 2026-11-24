import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { adCampaigns } from "@/db/schema";
import { getSessionUser, isSameOriginRequest } from "@/lib/auth";
import { getClientIp, rateLimit } from "@/lib/rateLimit";
import { recordAdEvent } from "@/lib/ads/events";
import { viewerCountryFromHeaders } from "@/lib/ads/targeting";
import { verifyServeToken, viewerKeyFor } from "@/lib/ads/tokens";
import { isSafeDestination } from "@/lib/ads/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const H = { "Cache-Control": "private, no-store" };
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: H });

/**
 * POST /api/ads/event  { token, type: "impression" | "click" }
 * The ONLY way impressions/clicks are recorded. The browser can't name a campaign: it presents the signed token issued
 * by /api/ads/serve. Duplicates (same viewer, same day) are ignored by a unique key in the database, cost/spend/
 * completion are applied server-side, and creators' own views never count. For a click the validated destination is
 * returned (never taken from the request).
 */
export async function POST(req: NextRequest) {
  if (!isSameOriginRequest(req)) return reply({ error: "Invalid request origin" }, 403);
  const ip = getClientIp(req);
  if (!rateLimit(`ads-event:${ip}`, 120, 60_000).allowed) return reply({ error: "Too many requests" }, 429);

  let body: { token?: unknown; type?: unknown };
  try {
    body = await req.json();
  } catch {
    return reply({ error: "Invalid request body" }, 400);
  }
  const type = body.type === "impression" || body.type === "click" ? body.type : null;
  const payload = verifyServeToken(body.token);
  if (!type || !payload) return reply({ error: "Invalid or expired ad token" }, 400);

  try {
    const [campaign] = await db.select().from(adCampaigns).where(eq(adCampaigns.publicId, payload.c)).limit(1);
    if (!campaign) return reply({ error: "Not found" }, 404);
    const viewer = await getSessionUser(req).catch(() => null);
    const result = await recordAdEvent({
      campaignId: campaign.id,
      type,
      placement: payload.s,
      viewerKey: viewerKeyFor(viewer?.id, ip, req.headers.get("user-agent")),
      userId: viewer?.id ?? null,
      country: viewerCountryFromHeaders(req.headers),
    });
    if (type === "click") {
      const live = campaign.status === "active" && isSafeDestination(campaign.targetUrl);
      return reply({ recorded: result.recorded, url: live ? campaign.targetUrl : null });
    }
    return reply({ recorded: result.recorded });
  } catch (e) {
    console.error("ads_event_failed", e instanceof Error ? e.message : e);
    return reply({ error: "Something went wrong" }, 500);
  }
}
