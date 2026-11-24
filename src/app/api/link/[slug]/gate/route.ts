import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { files } from "@/db/schema";
import { getSessionUser, isSameOriginRequest } from "@/lib/auth";
import { rateLimit } from "@/lib/rateLimit";
import { evaluateGate, findActiveGate } from "@/lib/ads/gate";
import { startJoin, verifyJoin } from "@/lib/ads/join";
import { getMembership } from "@/lib/ads/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const H = { "Cache-Control": "private, no-store" };
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: H });

/**
 * POST /api/link/<slug>/gate  { action: "start" | "verify" }
 * The membership gate (Force Join) of ONE file. `start` is called when the gate is first shown: it answers whether the gate
 * is open for this viewer and records the "were they already a member?" baseline. `verify` re-checks with Telegram after
 * the viewer says they joined. The client never states membership — it can only ask the server to check.
 * Responses: { gated: false } | { gated: true, state, channelTitle, channelUsername, joinUrl }.
 * The actual file release stays in POST /api/link/<slug>, which enforces the same gate independently.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  if (!isSameOriginRequest(req)) return reply({ error: "Invalid request origin" }, 403);
  let body: { action?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return reply({ error: "Invalid request body" }, 400);
  }
  const action = body.action === "start" || body.action === "verify" ? body.action : null;
  if (!action) return reply({ error: "Invalid action" }, 400);

  try {
    const { slug } = await params;
    const viewer = await getSessionUser(req).catch(() => null);
    const key = viewer ? `gate:u${viewer.id}` : `gate:ip:${req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown"}`;
    if (!rateLimit(key, 30, 60_000).allowed) return reply({ error: "Too many requests" }, 429);

    const [file] = await db.select({ id: files.id, userId: files.userId, isPublished: files.isPublished }).from(files).where(eq(files.smartLinkSlug, slug)).limit(1);
    if (!file || !file.isPublished) return reply({ error: "File not found" }, 404);

    const gate = await findActiveGate(file.id);
    if (!gate) return reply({ gated: false });

    const initial = await evaluateGate(file, gate, viewer, getMembership);
    if (!initial.gated) return reply({ gated: false });
    const out = (e: typeof initial) => reply({ gated: true, state: e.gated ? e.state : "passed", channelTitle: e.gated ? e.info.channelTitle : null, channelUsername: e.gated ? e.info.channelUsername : null, joinUrl: e.gated ? e.info.joinUrl : null });
    if (!viewer || initial.state === "login_required") return out(initial);

    // Record / confirm the verified-join attribution for this campaign (never counts existing members, never counts clicks).
    const tgUserId = Number(viewer.telegramId);
    const ref = { id: gate.id, tgChatId: gate.tgChatId };
    if (action === "start") await startJoin(ref, viewer.id, tgUserId, getMembership);
    else if (initial.state === "passed") await verifyJoin(ref, viewer.id, tgUserId, getMembership);
    return out(initial);
  } catch (e) {
    console.error("force_join_gate_failed", e instanceof Error ? e.message : e);
    return reply({ error: "Something went wrong" }, 500);
  }
}
