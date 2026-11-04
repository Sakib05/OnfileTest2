import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { runMaintenance } from "@/lib/storage/maintenance";

export const dynamic = "force-dynamic";
// Vercel Hobby caps function duration; keep the run inside a conservative budget.
export const maxDuration = 60;

function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/**
 * Storage maintenance (health, usage sync, quota evaluation, migrations,
 * orphan cleanup, alerts). Vercel Cron sends `Authorization: Bearer $CRON_SECRET`
 * automatically when the CRON_SECRET env var is set on the project.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  }
  const header = req.headers.get("authorization") ?? "";
  if (!safeEqual(header, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const report = await runMaintenance();
    return NextResponse.json({ ok: true, report }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("storage_cron_failed", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ ok: false, error: "Maintenance failed" }, { status: 500 });
  }
}
