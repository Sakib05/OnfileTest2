import { NextRequest } from "next/server";
import { apiError, guardCreator, json, readJson } from "@/lib/ads/http";
import { dbDestinationDeps, getCreatorCampaign, loadAnalytics, serializeMany } from "@/lib/ads/repo";
import { updateDraft } from "@/lib/ads/service";
import { isValidPublicId } from "@/lib/ads/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ ref: string }> };

/** GET /api/advertise/[ref] — details + real recorded analytics for the creator's OWN campaign (404 for anyone else's). */
export async function GET(req: NextRequest, { params }: Ctx) {
  const g = await guardCreator(req, { mutating: false, bucket: "detail", limit: 60 });
  if ("response" in g) return g.response;
  const { ref } = await params;
  if (!isValidPublicId(ref)) return apiError("Campaign not found.", 404);
  try {
    const row = await getCreatorCampaign(g.user.id, ref);
    if (!row) return apiError("Campaign not found.", 404);
    const [campaign] = await serializeMany([row]);
    return json({ campaign, analytics: await loadAnalytics(row.id) });
  } catch (e) {
    console.error("advertise_detail_failed", e instanceof Error ? e.message : e);
    return apiError("Couldn't load this campaign.", 500);
  }
}

/** PATCH /api/advertise/[ref] — update a DRAFT. Non-drafts answer 409. Status/spend/counters can't be sent. */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const g = await guardCreator(req, { mutating: true, bucket: "update", limit: 60 });
  if ("response" in g) return g.response;
  const { ref } = await params;
  if (!isValidPublicId(ref)) return apiError("Campaign not found.", 404);
  const body = await readJson(req);
  if (body === null) return apiError("Invalid request body.", 400);
  try {
    const r = await updateDraft(g.user.id, ref, body, dbDestinationDeps);
    if (!r.ok) return apiError(r.error, r.status, r.fieldErrors ? { fieldErrors: r.fieldErrors } : {});
    const [campaign] = await serializeMany([r.campaign]);
    return json({ campaign });
  } catch (e) {
    console.error("advertise_update_failed", e instanceof Error ? e.message : e);
    return apiError("Couldn't save the draft.", 500);
  }
}
