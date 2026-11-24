import { NextRequest, NextResponse } from "next/server";
import { and, eq, gt, gte, lte, ne, or, sql, isNull } from "drizzle-orm";
import { db } from "@/db";
import { adCampaigns } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { getClientIp, rateLimit } from "@/lib/rateLimit";
import { SLOT_PLACEMENTS, isSlotKey } from "@/lib/ads/constants";
import { sweepExpiredCampaigns } from "@/lib/ads/events";
import { matchesTargeting, viewerCountryFromHeaders } from "@/lib/ads/targeting";
import { signServeToken } from "@/lib/ads/tokens";
import { thumbnailsFor } from "@/lib/ads/repo";
import { toNumber } from "@/lib/ads/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NONE = () => NextResponse.json({ ad: null }, { headers: { "Cache-Control": "private, no-store" } });

/**
 * GET /api/ads/serve?slot=library|file_access|playlist_between
 * Public (file/playlist pages are public). Returns AT MOST one eligible, admin-approved, payment-confirmed, in-date,
 * in-budget campaign — never anything else — plus a signed token that /api/ads/event requires to record an impression
 * or click. No destination URL, creator identity or budget is exposed here. "No ad" is a normal, silent answer.
 */
export async function GET(req: NextRequest) {
  const slot = req.nextUrl.searchParams.get("slot");
  if (!isSlotKey(slot)) return NextResponse.json({ error: "Unknown slot" }, { status: 400 });
  if (!rateLimit(`ads-serve:${getClientIp(req)}`, 90, 60_000).allowed) return NONE();

  try {
    await sweepExpiredCampaigns();
    const viewer = await getSessionUser(req).catch(() => null);
    const now = new Date();
    const placementMatch = or(...SLOT_PLACEMENTS[slot].map((p) => sql`${adCampaigns.placements} ? ${p}`));

    const rows = await db
      .select()
      .from(adCampaigns)
      .where(
        and(
          eq(adCampaigns.status, "active"),
          eq(adCampaigns.paymentStatus, "confirmed"),
          eq(adCampaigns.source, "creator"),
          placementMatch,
          or(isNull(adCampaigns.startDate), lte(adCampaigns.startDate, now)),
          or(isNull(adCampaigns.endDate), gte(adCampaigns.endDate, now)),
          sql`${adCampaigns.targetUrl} IS NOT NULL`,
          viewer ? or(isNull(adCampaigns.userId), ne(adCampaigns.userId, viewer.id)) : undefined,
          gt(sql`COALESCE(${adCampaigns.budget}, 0) - COALESCE(${adCampaigns.spent}, 0)`, sql`0`)
        )
      )
      .limit(30);

    const target = { country: viewerCountryFromHeaders(req.headers), language: viewer?.language ?? null };
    const eligible = rows.filter((r) => matchesTargeting(r.targeting, target));
    if (eligible.length === 0) return NONE();

    // Fair rotation: pick randomly among campaigns weighted toward the ones that have been shown the least.
    const weights = eligible.map((r) => 1 / (1 + (r.impressions ?? 0)));
    const total = weights.reduce((a, b) => a + b, 0);
    let pick = Math.random() * total;
    let chosen = eligible[0];
    for (let i = 0; i < eligible.length; i++) {
      pick -= weights[i];
      if (pick <= 0) {
        chosen = eligible[i];
        break;
      }
    }

    const thumbs = await thumbnailsFor([chosen]);
    return NextResponse.json(
      {
        ad: {
          token: signServeToken(chosen.publicId ?? "", slot),
          adType: chosen.adType,
          objective: chosen.objective,
          headline: chosen.headline ?? chosen.campaignName ?? "",
          description: chosen.description ?? "",
          ctaText: chosen.ctaText ?? "Open",
          thumbnailUrl: thumbs.get(chosen.id) ?? null,
          channelTitle: chosen.tgChatTitle ?? null,
          joinFlow: chosen.objective === "verified_joins" && !!chosen.joinVerifiable,
          // Present only so the UI can show nothing misleading: price/budget are never sent.
          hasBudget: toNumber(chosen.budget) > 0,
        },
      },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (e) {
    console.error("ads_serve_failed", e instanceof Error ? e.message : e);
    return NONE();
  }
}
