import { NextRequest } from "next/server";
import { apiError, guardCreator, json, readJson } from "@/lib/ads/http";
import { resolveDestination } from "@/lib/ads/destination";
import { dbDestinationDeps } from "@/lib/ads/repo";
import { validateCampaignInput } from "@/lib/ads/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/advertise/resolve — validates a destination SERVER-SIDE (ownership, Telegram lookup, bot permissions) and
 * returns what can be previewed plus whether verified joins are possible. Used by the wizard for an honest preview and
 * the "verified joins" decision. Nothing is saved. It is re-run on submit; the client's answer is never trusted.
 */
export async function POST(req: NextRequest) {
  const g = await guardCreator(req, { mutating: true, bucket: "resolve", limit: 20 });
  if ("response" in g) return g.response;
  const body = await readJson(req);
  if (body === null) return apiError("Invalid request body.", 400);
  const v = validateCampaignInput(body, "draft");
  if (!v.ok) return apiError("Please check the destination.", 400, { fieldErrors: v.errors });
  try {
    const r = await resolveDestination(v.value, g.user.id, dbDestinationDeps);
    if (!r.ok) return apiError(r.error, r.status ?? 422, { field: r.field });
    const d = r.value;
    return json({
      destination: {
        label: d.label,
        ownership: d.ownership,
        channelUsername: d.tgChatUsername,
        joinVerifiable: d.joinVerifiable,
        joinNote: d.joinNote,
        suggestedDescription: d.suggestedDescription ? d.suggestedDescription.slice(0, 140) : null,
      },
    });
  } catch (e) {
    console.error("advertise_resolve_failed", e instanceof Error ? e.message : e);
    return apiError("Couldn't check that destination.", 500);
  }
}
