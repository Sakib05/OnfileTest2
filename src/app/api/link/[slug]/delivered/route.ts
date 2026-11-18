import { NextRequest, NextResponse } from "next/server";
import { isSameOriginRequest } from "@/lib/auth";
import { getClientIp, rateLimit } from "@/lib/rateLimit";
import { confirmPlaylistDownload, isReceipt } from "@/lib/playlistAnalytics";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" } as const;

type Ctx = { params: Promise<{ slug: string }> };

/**
 * Confirms the hand-off of ONE unlocked file: the visitor opened the Telegram link the server released.
 * Counts one playlist "download" for the playlist the unlock was attributed to (see src/lib/playlistAnalytics.ts).
 *
 * Idempotent and unforgeable: the body must carry the random receipt issued by POST /api/link/<slug>; a receipt can be
 * confirmed exactly once, for that file only, within 30 minutes. Replays, retries, wrong files and invented receipts all
 * answer 200 `{ counted: false }` — the response never reveals whether a receipt exists. Never touches Telegram
 * and never changes access rules.
 */
export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    if (!isSameOriginRequest(req)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403, headers: NO_STORE });
    if (!rateLimit(`link-delivered:${getClientIp(req)}`, 60, 60_000).allowed) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: NO_STORE });
    }
    const { slug } = await params;
    let receipt: unknown;
    try {
      receipt = ((await req.json()) as { receipt?: unknown })?.receipt;
    } catch {
      receipt = undefined;
    }
    if (!isReceipt(receipt) || typeof slug !== "string" || slug.length > 64) {
      return NextResponse.json({ counted: false }, { headers: NO_STORE });
    }
    const counted = await confirmPlaylistDownload(slug, receipt);
    return NextResponse.json({ counted }, { headers: NO_STORE });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
