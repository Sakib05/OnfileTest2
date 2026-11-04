import { NextRequest, NextResponse } from "next/server";
import { buildSnapshot, requireAdmin, runAdminAction } from "@/lib/storage/admin";
import { sharedRateLimit } from "@/lib/storage/sharedRateLimit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if ("response" in auth) return auth.response;
  try {
    return NextResponse.json(await buildSnapshot(), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("storage_admin_snapshot_failed", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req, { mutating: true });
  if ("response" in auth) return auth.response;
  const limited = await sharedRateLimit(`storage-admin:u${auth.user.id}`, 60, 60);
  if (!limited.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const result = await runAdminAction({ id: auth.user.id, telegramId: auth.user.telegramId }, body);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, result: result.result ?? null });
}
