import { NextRequest, NextResponse } from "next/server";
import { isSameOriginRequest } from "@/lib/auth";
import { requireAdmin } from "@/lib/adminAuth";
import { getDbbyteConfig, getUsageThresholds } from "@/lib/thumbnails/config";
import { getAdminSnapshot, upsertManualUsage } from "@/lib/thumbnails/repo";
import { retryOrphanCleanup } from "@/lib/thumbnails/cleanup";
import { notifyAdmins } from "@/lib/thumbnails/notify";
import {
  USAGE_METRICS,
  levelRank,
  maxLevel,
  usageLevel,
  usagePercent,
  uploadsBlocked,
  type UsageLevel,
  type UsageMetric,
} from "@/lib/thumbnails/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "private, no-store" };

async function buildStatus() {
  const t = getUsageThresholds();
  const snap = await getAdminSnapshot();
  const metrics = USAGE_METRICS.map((metric) => {
    const row = snap.manual.find((r) => r.metric === metric);
    if (!row) return { metric, source: "unknown" as const, used: null, limit: null, percent: null, level: "ok" as UsageLevel, updatedAt: null };
    const percent = usagePercent(row.used, row.limit);
    return {
      metric,
      // DBByte has no usage API: every figure here is admin-entered.
      source: "manual" as const,
      used: row.used,
      limit: row.limit,
      percent,
      level: usageLevel(percent, t),
      updatedAt: row.updatedAt,
    };
  });
  const overall = maxLevel(metrics.map((m) => m.level));
  return {
    configured: !!getDbbyteConfig(),
    officialUsageApiAvailable: false,
    thresholds: t,
    overallLevel: overall,
    uploadsBlocked: uploadsBlocked(overall),
    metrics,
    estimated: { source: "estimated" as const, ...snap.estimated },
    orphanCount: snap.orphanCount,
    failuresLast7d: snap.failuresLast7d,
    recentFailures: snap.failures,
  };
}

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if ("response" in auth) return auth.response;
  try {
    return NextResponse.json(await buildStatus(), { headers: NO_STORE });
  } catch (err) {
    console.error("admin_storage_status_failed", err instanceof Error ? err.message : "unknown_error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}

/** PUT { metric, used, limit } — manual usage entry. POST { action: "retry_orphans" }. */
export async function PUT(req: NextRequest) {
  if (!isSameOriginRequest(req)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  const auth = await requireAdmin(req);
  if ("response" in auth) return auth.response;

  let body: { metric?: unknown; used?: unknown; limit?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const metric = body.metric as UsageMetric;
  const used = Number(body.used);
  const limit = Number(body.limit);
  if (!USAGE_METRICS.includes(metric)) return NextResponse.json({ error: "Invalid metric" }, { status: 400 });
  if (!Number.isFinite(used) || used < 0 || !Number.isFinite(limit) || limit <= 0 || used > 1e15 || limit > 1e15) {
    return NextResponse.json({ error: "Used must be ≥ 0 and limit must be > 0" }, { status: 400 });
  }

  try {
    const before = await buildStatus();
    await upsertManualUsage(metric, Math.round(used), Math.round(limit), auth.user.id);
    const after = await buildStatus();
    // Notify admins only when the overall level gets worse (warning/high/restricted/full).
    if (levelRank(after.overallLevel) > levelRank(before.overallLevel) && after.overallLevel !== "ok") {
      const pct = Math.max(...after.metrics.map((m) => m.percent ?? 0)).toFixed(0);
      await notifyAdmins(
        `Onfile thumbnail storage: ${after.overallLevel.toUpperCase()} (${pct}% of a DBByte limit, manual figures).` +
          (after.uploadsBlocked ? " New thumbnail uploads are now paused." : "")
      );
    }
    return NextResponse.json(after, { headers: NO_STORE });
  } catch (err) {
    console.error("admin_storage_update_failed", err instanceof Error ? err.message : "unknown_error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}

export async function POST(req: NextRequest) {
  if (!isSameOriginRequest(req)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  const auth = await requireAdmin(req);
  if ("response" in auth) return auth.response;
  try {
    const body = (await req.json().catch(() => ({}))) as { action?: string };
    if (body.action !== "retry_orphans") return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    const result = await retryOrphanCleanup();
    return NextResponse.json({ result, status: await buildStatus() }, { headers: NO_STORE });
  } catch (err) {
    console.error("admin_storage_action_failed", err instanceof Error ? err.message : "unknown_error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
