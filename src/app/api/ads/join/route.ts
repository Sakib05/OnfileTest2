import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { adCampaigns } from "@/db/schema";
import { getSessionUser, isSameOriginRequest } from "@/lib/auth";
import { rateLimit } from "@/lib/rateLimit";
import { startJoin, verifyJoin } from "@/lib/ads/join";
import { getMembership } from "@/lib/ads/telegram";
import { verifyServeToken } from "@/lib/ads/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const H = { "Cache-Control": "private, no-store" };
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: H });

/**
 * POST /api/ads/join  { token, action: "start" | "verify" }
 * Verified joins for channel campaigns. Requires a signed-in Onfile user (conversions are tied to that user + campaign).
 *   start  — server-side baseline: is the user ALREADY a member? (then they're recorded as such and never counted)
 *   verify — server-side getChatMember after a not-a-member baseline; counted at most once (unique DB key)
 * The client never says "I joined" — it can only ask the server to check.
 */
export async function POST(req: NextRequest) {
  if (!isSameOriginRequest(req)) return reply({ error: "Invalid request origin" }, 403);
  const user = await getSessionUser(req).catch(() => null);
  if (!user) return reply({ error: "Open Onfile in Telegram to verify your membership." }, 401);
  if (!rateLimit(`ads-join:${user.id}`, 20, 60_000).allowed) return reply({ error: "Too many requests" }, 429);

  let body: { token?: unknown; action?: unknown };
  try {
    body = await req.json();
  } catch {
    return reply({ error: "Invalid request body" }, 400);
  }
  const payload = verifyServeToken(body.token);
  const action = body.action === "start" || body.action === "verify" ? body.action : null;
  if (!payload || !action) return reply({ error: "Invalid or expired ad token" }, 400);

  const tgUserId = Number(user.telegramId);
  if (!Number.isSafeInteger(tgUserId) || tgUserId <= 0) return reply({ error: "Your Telegram identity is unavailable." }, 400);

  try {
    const [c] = await db.select().from(adCampaigns).where(eq(adCampaigns.publicId, payload.c)).limit(1);
    if (!c || c.status !== "active" || c.objective !== "verified_joins" || !c.joinVerifiable || !c.tgChatId) {
      return reply({ error: "This campaign isn't accepting joins." }, 410);
    }
    if (c.userId === user.id) return reply({ error: "You can't join your own campaign." }, 403);

    const fn = action === "start" ? startJoin : verifyJoin;
    const out = await fn({ id: c.id, tgChatId: c.tgChatId }, user.id, tgUserId, getMembership);
    if (out.ok) return reply({ state: out.state });
    if (out.code === "start_required") return reply({ error: "Tap Join first.", code: out.code }, 409);
    if (out.code === "campaign_ended") return reply({ error: "This campaign has ended.", code: out.code }, 410);
    return reply({ error: "We couldn't check your membership with Telegram right now. Please try again.", code: out.code }, 503);
  } catch (e) {
    console.error("ads_join_failed", e instanceof Error ? e.message : e);
    return reply({ error: "Something went wrong" }, 500);
  }
}
