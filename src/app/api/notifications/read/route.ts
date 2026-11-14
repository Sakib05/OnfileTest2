import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, isSameOriginRequest, unauthorized } from "@/lib/auth";
import {
  countUnreadNotifications,
  isValidPublicId,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/notifications";

export const dynamic = "force-dynamic";

/**
 * Marks notifications as read for the signed-in creator.
 *
 *   POST { "id": "<notification id>" }  → marks that one notification read
 *   POST { "all": true }                → marks every unread notification read
 *
 * Responds with the fresh `unreadCount` so the badge can update without a
 * reload. Ownership is enforced in the SQL itself (`user_id = session user`):
 * a notification id that belongs to someone else is answered with 404, exactly
 * like one that does not exist.
 */
export async function POST(req: NextRequest) {
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  try {
    const user = await getSessionUser(req);
    if (!user) return unauthorized();

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    const { id, all } = body as { id?: unknown; all?: unknown };

    if (all === true && id === undefined) {
      const updated = await markAllNotificationsRead(user.id);
      return NextResponse.json({ updated, unreadCount: await countUnreadNotifications(user.id) });
    }

    if (id !== undefined && all === undefined) {
      if (!isValidPublicId(id)) {
        return NextResponse.json({ error: "Invalid notification id" }, { status: 400 });
      }
      const result = await markNotificationRead(user.id, id);
      if (!result.found) {
        return NextResponse.json({ error: "Notification not found" }, { status: 404 });
      }
      return NextResponse.json({ updated: result.changed ? 1 : 0, unreadCount: await countUnreadNotifications(user.id) });
    }

    return NextResponse.json({ error: 'Provide either { "id": string } or { "all": true }' }, { status: 400 });
  } catch (err) {
    console.error("notifications_mark_read_failed", err instanceof Error ? err.message : "unknown_error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
