import { NextRequest } from "next/server";
import { apiError, guardCreator, json, readJson } from "@/lib/ads/http";
import { dbDestinationDeps, serializeMany } from "@/lib/ads/repo";
import { creatorAction, submitCampaign } from "@/lib/ads/service";
import { isValidPublicId } from "@/lib/ads/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIONS = ["submit", "pause", "resume", "reopen", "delete"] as const;

/**
 * POST /api/advertise/[ref]/action  { action: "submit" | "pause" | "resume" | "reopen" | "delete" }
 * Creators can only perform creator transitions on their OWN campaigns. "approve", "reject", "complete" etc. exist
 * solely in the admin API and are rejected here as unknown actions.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ ref: string }> }) {
  const g = await guardCreator(req, { mutating: true, bucket: "action", limit: 30 });
  if ("response" in g) return g.response;
  const { ref } = await params;
  if (!isValidPublicId(ref)) return apiError("Campaign not found.", 404);
  const body = (await readJson(req)) as { action?: unknown } | null;
  const action = ACTIONS.find((a) => a === body?.action);
  if (!action) return apiError("Unknown action.", 400);

  try {
    if (action === "submit") {
      const r = await submitCampaign(g.user.id, ref, dbDestinationDeps);
      if (!r.ok) return apiError(r.error, r.status, r.fieldErrors ? { fieldErrors: r.fieldErrors } : {});
      const [campaign] = await serializeMany([r.campaign]);
      return json({ campaign, alreadySubmitted: r.alreadyDone === true });
    }
    const r = await creatorAction(g.user.id, ref, action);
    if (!r.ok) return apiError(r.error, r.status);
    if (!r.campaign) return json({ deleted: true });
    const [campaign] = await serializeMany([r.campaign]);
    return json({ campaign });
  } catch (e) {
    console.error("advertise_action_failed", e instanceof Error ? e.message : e);
    return apiError("Something went wrong. Please try again.", 500);
  }
}
