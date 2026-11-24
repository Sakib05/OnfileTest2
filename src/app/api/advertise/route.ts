import { NextRequest } from "next/server";
import { apiError, guardCreator, json, readJson } from "@/lib/ads/http";
import { createDraft } from "@/lib/ads/service";
import { dbDestinationDeps, listCreatorCampaigns, serializeMany } from "@/lib/ads/repo";
import { buildOverview } from "@/lib/ads/serialize";
import { PRICING_NOTICE } from "@/lib/ads/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/advertise — the AUTHENTICATED creator's own campaigns + an overview computed from those rows only.
 * (The previous version returned every advertiser's records to anyone; that public listing no longer exists.)
 */
export async function GET(req: NextRequest) {
  const g = await guardCreator(req, { mutating: false, bucket: "list", limit: 60 });
  if ("response" in g) return g.response;
  try {
    const rows = await listCreatorCampaigns(g.user.id);
    return json({ campaigns: await serializeMany(rows), overview: buildOverview(rows), pricingNotice: PRICING_NOTICE });
  } catch (e) {
    console.error("advertise_list_failed", e instanceof Error ? e.message : e);
    return apiError("Couldn't load your campaigns.", 500);
  }
}

/** POST /api/advertise — create a DRAFT (idempotent on `clientRef`). Submitting for review is a separate action. */
export async function POST(req: NextRequest) {
  const g = await guardCreator(req, { mutating: true, bucket: "create", limit: 20 });
  if ("response" in g) return g.response;
  const body = await readJson(req);
  if (body === null) return apiError("Invalid request body.", 400);
  try {
    const r = await createDraft(g.user, body, dbDestinationDeps);
    if (!r.ok) return apiError(r.error, r.status, r.fieldErrors ? { fieldErrors: r.fieldErrors } : {});
    const [campaign] = await serializeMany([r.campaign]);
    return json({ campaign, created: r.created ?? true }, r.created === false ? 200 : 201);
  } catch (e) {
    console.error("advertise_create_failed", e instanceof Error ? e.message : e);
    return apiError("Couldn't save the draft.", 500);
  }
}
