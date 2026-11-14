import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, unauthorized } from "@/lib/auth";
import { countUnreadNotifications, listNotifications } from "@/lib/notifications";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * The signed-in creator's notifications. The user comes ONLY from the session
 * cookie — there is no user-id parameter, so another user's notifications can
 * never be requested.
 *
 *   GET /api/notifications            → { notifications: [...newest first], unreadCount }
 *   GET /api/notifications?summary=1  → { unreadCount }   (cheap call used for the bell badge)
 *
 * If the `notifications` table has not been migrated yet the endpoint answers
 * with an empty list rather than an error, so the Dashboard keeps working.
 */
export async function GET(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) return unauthorized();

  try {
    const summary = new URL(req.url).searchParams.get("summary") === "1";
    if (summary) {
      return NextResponse.json({ unreadCount: await countUnreadNotifications(user.id) }, { headers: NO_STORE });
    }
    return NextResponse.json(await listNotifications(user.id), { headers: NO_STORE });
  } catch (err) {
    console.error("notifications_list_failed", err instanceof Error ? err.message : "unknown_error");
    return NextResponse.json({ notifications: [], unreadCount: 0, degraded: true }, { headers: NO_STORE });
  }
}
