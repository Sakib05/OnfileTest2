import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/db";
import { files, notifications, type NotificationRow } from "@/db/schema";

/**
 * In-app notifications (the Dashboard bell).
 *
 * Rules this module enforces:
 *   - A notification is only ever created by SERVER code reacting to a genuine
 *     backend event (see the `notifyUser` call sites: channel connected /
 *     failed / disconnected / bot lost admin, file published, withdrawal
 *     requested). There is no HTTP endpoint that creates one and nothing is
 *     created because a page was merely visited.
 *   - Every read and update is scoped to a `userId` that the caller took from
 *     the authenticated session — never from the request. A notification that
 *     belongs to someone else behaves exactly like one that does not exist.
 *   - The browser only ever sees the opaque `publicId` (never the serial id)
 *     and a coarse destination TYPE (never the referenced row id).
 *   - `notifyUser` never throws: a failed notification (e.g. the table has not
 *     been migrated yet) must never break the event that produced it.
 */

export type NotificationType =
  | "channel_connected"
  | "channel_connection_failed"
  | "channel_disconnected"
  | "channel_attention"
  | "file_published"
  | "withdrawal_requested";

/** Where tapping a notification leads. `file` → Library, `channels` → Profile › Channel Management, `wallet` → Wallet. */
export type NotificationDestinationType = "file" | "channels" | "wallet";

export const DESTINATION_TYPES: readonly NotificationDestinationType[] = ["file", "channels", "wallet"];

/** Keep the table small: only the newest N notifications per user are retained. */
export const MAX_NOTIFICATIONS_PER_USER = 200;
/** Page size of the notification list. */
export const NOTIFICATION_LIST_LIMIT = 50;

const TITLE_MAX = 160;
const BODY_MAX = 400;

export interface NotifyInput {
  userId: number;
  type: NotificationType;
  title: string;
  body: string;
  destination?: { type: NotificationDestinationType; ref?: number | string | null } | null;
  /** Optional idempotency key, unique per user: the same event can never create two rows. */
  dedupeKey?: string;
}

export interface PublicNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
  /** `available: false` means the target no longer exists (e.g. the file was deleted). */
  destination: { type: NotificationDestinationType; available: boolean } | null;
}

/** Strips control characters and clamps length — channel names etc. originate from Telegram users. */
export function clean(text: string, max: number): string {
  // eslint-disable-next-line no-control-regex
  const stripped = String(text ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return stripped.length > max ? `${stripped.slice(0, max - 1).trimEnd()}…` : stripped;
}

/** The opaque id format produced by `nanoid(21)`; anything else is rejected before touching the database. */
export function isValidPublicId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{10,24}$/.test(value);
}

/**
 * Records a notification for `userId`. Returns whether a NEW row was created
 * (`false` for a duplicate `dedupeKey`, invalid input or any database error).
 * Never throws.
 */
export async function notifyUser(input: NotifyInput): Promise<boolean> {
  try {
    if (!Number.isInteger(input.userId) || input.userId <= 0) return false;
    const title = clean(input.title, TITLE_MAX);
    const body = clean(input.body, BODY_MAX);
    if (!title || !body) return false;

    const dest = input.destination ?? null;
    const destinationType = dest && DESTINATION_TYPES.includes(dest.type) ? dest.type : null;
    const destinationRef = destinationType && dest?.ref != null ? clean(String(dest.ref), 32) || null : null;

    const inserted = await db
      .insert(notifications)
      .values({
        publicId: nanoid(21),
        userId: input.userId,
        type: input.type,
        title,
        body,
        destinationType,
        destinationRef,
        dedupeKey: input.dedupeKey ? clean(input.dedupeKey, 96) : null,
        createdAt: new Date(),
      })
      .onConflictDoNothing()
      .returning({ id: notifications.id });

    if (inserted.length === 0) return false;
    await pruneOldNotifications(input.userId);
    return true;
  } catch (err) {
    console.error("notification_create_failed", { type: input.type, message: err instanceof Error ? err.message : "unknown_error" });
    return false;
  }
}

async function pruneOldNotifications(userId: number): Promise<void> {
  try {
    await db.execute(sql`
      delete from notifications
      where user_id = ${userId}
        and id not in (
          select id from notifications where user_id = ${userId}
          order by created_at desc, id desc
          limit ${MAX_NOTIFICATIONS_PER_USER}
        )
    `);
  } catch {
    /* retention is best-effort */
  }
}

/** Resolves, for the given rows, whether a `file` destination still exists AND belongs to `userId`. */
async function availableFileIds(userId: number, rows: NotificationRow[]): Promise<Set<number>> {
  const ids = rows
    .filter((r) => r.destinationType === "file" && r.destinationRef && /^\d{1,9}$/.test(r.destinationRef))
    .map((r) => Number(r.destinationRef));
  if (ids.length === 0) return new Set();
  const found = await db
    .select({ id: files.id })
    .from(files)
    .where(and(eq(files.userId, userId), inArray(files.id, [...new Set(ids)])));
  return new Set(found.map((f) => f.id));
}

export function toPublicNotification(row: NotificationRow, existingFileIds: Set<number>): PublicNotification {
  let destination: PublicNotification["destination"] = null;
  const type = row.destinationType as NotificationDestinationType | null;
  if (type && DESTINATION_TYPES.includes(type)) {
    const available = type === "file" ? !!row.destinationRef && existingFileIds.has(Number(row.destinationRef)) : true;
    destination = { type, available };
  }
  return {
    id: row.publicId,
    type: row.type,
    title: row.title,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    read: row.readAt !== null,
    destination,
  };
}

export async function countUnreadNotifications(userId: number): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return row?.n ?? 0;
}

/** Newest-first notifications of `userId` plus the TOTAL unread count (not just the unread ones in this page). */
export async function listNotifications(
  userId: number,
  limit: number = NOTIFICATION_LIST_LIMIT
): Promise<{ notifications: PublicNotification[]; unreadCount: number }> {
  const safeLimit = Math.min(Math.max(Math.trunc(limit) || NOTIFICATION_LIST_LIMIT, 1), NOTIFICATION_LIST_LIMIT);
  const rows = await db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(safeLimit);
  const [fileIds, unreadCount] = await Promise.all([availableFileIds(userId, rows), countUnreadNotifications(userId)]);
  return { notifications: rows.map((r) => toPublicNotification(r, fileIds)), unreadCount };
}

export type MarkReadResult = { found: false } | { found: true; changed: boolean };

/**
 * Marks ONE notification read. `found: false` covers both "no such id" and
 * "belongs to another user" so ownership is never revealed.
 */
export async function markNotificationRead(userId: number, publicId: string): Promise<MarkReadResult> {
  if (!isValidPublicId(publicId)) return { found: false };
  const updated = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, userId), eq(notifications.publicId, publicId), isNull(notifications.readAt)))
    .returning({ id: notifications.id });
  if (updated.length > 0) return { found: true, changed: true };

  const [existing] = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.publicId, publicId)))
    .limit(1);
  return existing ? { found: true, changed: false } : { found: false };
}

/** Marks every unread notification of `userId` read; returns how many changed. */
export async function markAllNotificationsRead(userId: number): Promise<number> {
  const updated = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
    .returning({ id: notifications.id });
  return updated.length;
}
