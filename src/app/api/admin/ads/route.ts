import { NextRequest, NextResponse } from "next/server";
import { desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { adCampaigns, users } from "@/db/schema";
import { isSameOriginRequest } from "@/lib/auth";
import { requireAdmin } from "@/lib/adminAuth";
import { rateLimit } from "@/lib/rateLimit";
import { CAMPAIGN_STATUSES } from "@/lib/ads/constants";
import { adminAct } from "@/lib/ads/adminService";
import { dbDestinationDeps, thumbnailsFor } from "@/lib/ads/repo";
import { sweepExpiredCampaigns } from "@/lib/ads/events";
import { serializeCampaign } from "@/lib/ads/serialize";
import { isValidPublicId } from "@/lib/ads/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const H = { "Cache-Control": "private, no-store" };
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: H });

/**
 * GET /api/admin/ads?status=pending|active|…|all — admin-only review queue. Admin identity comes ONLY from the verified
 * server-side session + ADMIN_TELEGRAM_IDS (src/lib/adminAuth.ts). Ordinary creators get 403; the client can't opt in.
 * Drafts are never listed (they aren't submitted). Legacy rows (no owner) are only counted.
 */
export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("response" in admin) return admin.response;
  const status = req.nextUrl.searchParams.get("status") ?? "pending";
  const filter = CAMPAIGN_STATUSES.find((s) => s === status && s !== "draft");
  try {
    await sweepExpiredCampaigns();
    const where = filter ? eq(adCampaigns.status, filter) : sql`${adCampaigns.status} <> 'draft'`;
    const rows = await db
      .select({ c: adCampaigns, uName: users.firstName, uCustom: users.displayNameCustom, uUsername: users.username })
      .from(adCampaigns)
      .leftJoin(users, eq(users.id, adCampaigns.userId))
      .where(sql`${adCampaigns.userId} IS NOT NULL AND ${where}`)
      .orderBy(desc(adCampaigns.submittedAt), desc(adCampaigns.createdAt))
      .limit(200);
    const thumbs = await thumbnailsFor(rows.map((r) => r.c));
    const [{ legacy }] = await db.select({ legacy: sql<number>`count(*)::int` }).from(adCampaigns).where(isNull(adCampaigns.userId));
    const [{ pending }] = await db.select({ pending: sql<number>`count(*)::int` }).from(adCampaigns).where(sql`${adCampaigns.userId} IS NOT NULL AND ${adCampaigns.status} = 'pending'`);
    return reply({
      campaigns: rows.map((r) => ({
        ...serializeCampaign(r.c, { thumbnailUrl: thumbs.get(r.c.id) ?? null }),
        creator: { name: r.uCustom ?? r.uName ?? "Creator", username: r.uUsername },
        sourceKind: r.c.source,
      })),
      pendingCount: pending,
      legacyCount: legacy,
    });
  } catch (e) {
    console.error("admin_ads_list_failed", e instanceof Error ? e.message : e);
    return reply({ error: "Couldn't load campaigns." }, 500);
  }
}

/** POST /api/admin/ads { ref, action: approve|reject|pause|resume|complete, reason?, unitPrice?, paymentConfirmed? } */
export async function POST(req: NextRequest) {
  if (!isSameOriginRequest(req)) return reply({ error: "Invalid request origin" }, 403);
  const admin = await requireAdmin(req);
  if ("response" in admin) return admin.response;
  if (!rateLimit(`admin-ads:${admin.user.id}`, 60, 60_000).allowed) return reply({ error: "Too many requests" }, 429);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return reply({ error: "Invalid request body" }, 400);
  }
  const action = (["approve", "reject", "pause", "resume", "complete"] as const).find((a) => a === body.action);
  if (!action || !isValidPublicId(body.ref)) return reply({ error: "Invalid request" }, 400);

  try {
    const r = await adminAct(admin.user.id, body.ref, { action, reason: body.reason, unitPrice: body.unitPrice, paymentConfirmed: body.paymentConfirmed }, dbDestinationDeps);
    if (!r.ok) return reply({ error: r.error }, r.status);
    return reply({ campaign: serializeCampaign(r.campaign) });
  } catch (e) {
    console.error("admin_ads_action_failed", e instanceof Error ? e.message : e);
    return reply({ error: "Something went wrong" }, 500);
  }
}
