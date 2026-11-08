import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, unauthorized } from "@/lib/auth";
import { isPaidPublishingAvailable } from "@/lib/publishing/payments";

export const dynamic = "force-dynamic";

/**
 * Tells the Publish UI which optional capabilities are really backed by a
 * working server implementation, so it never offers something it can't
 * honour. The server still enforces the same rules on POST /api/files.
 */
export async function GET(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) return unauthorized();
  return NextResponse.json({ paidPublishing: isPaidPublishingAvailable() });
}
