/**
 * Server-side tracking + aggregation for the Creator Playlist Analytics page.
 *
 * Storage: the EXISTING `analytics` table (no second event system). Playlist events are rows with
 *   event_type = 'playlist_view' | 'playlist_unlock' | 'playlist_download' and a server-generated, UNIQUE `event_key`.
 * Legacy rows (written by the old open POST /api/analytics) have no event_key and are never counted here, so nobody can
 * inflate these numbers through that endpoint.
 *
 * ── Counting rules (also in docs/PLAYLIST_ANALYTICS.md) ──────────────────────────────────────────────────────────
 * VIEWS      A "view" is one valid load of a playlist's public page (GET /api/p/<token> that found a published
 *            playlist), counted once per anonymous visitor per playlist per 30-minute window (refreshes don't add up).
 *            Not counted: the playlist owner (preview), obvious bots/crawlers/link-preview fetchers, browser prefetches,
 *            and floods from one IP. "Unique viewers" = distinct anonymous visitor hashes.
 * DOWNLOADS  Onfile never delivers files itself: after the server authorises an unlock (password / ad rules, in
 *            POST /api/link/<slug>) the visitor is handed the Telegram message link and Telegram does not report back.
 *            So the strongest confirmation that exists is: server-verified unlock  +  the visitor tapping "Open in
 *            Telegram". The unlock issues a random receipt (a 'playlist_unlock' row); the tap (POST
 *            /api/link/<slug>/delivered) atomically turns THAT row into a 'playlist_download'. One unlock → at most one
 *            download, however many times the request is retried. A new unlock that is opened again is a new delivery.
 *            Unlocks that are never opened are never counted.
 * ATTRIBUTION A download belongs to the playlist whose public page the visitor was on when unlocking (the playlist
 *            token is sent with the unlock and re-validated server-side: published, not Stars-locked, password
 *            unlocked, file really a member). Standalone /f/<slug> unlocks carry no playlist and are not attributed.
 *            A file in several playlists is therefore counted only for the playlist it was actually requested through.
 * EARNINGS   No per-playlist revenue records exist in this codebase (see docs) → reported as "not available".
 */
import crypto from "crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { analytics, playlistFiles } from "@/db/schema";
import { getClientIp, rateLimit } from "@/lib/rateLimit";
import { findSharedPlaylist, lockFor, unlockCookieName, verifyUnlockToken } from "@/lib/publicPlaylist";
import { getSessionUser } from "@/lib/auth";
import { buildSeries, formatDateLabel, type DailyCounts, type Granularity, type ResolvedRange } from "@/lib/playlistAnalyticsRange";
import type { NextRequest, NextResponse } from "next/server";

export const EV_VIEW = "playlist_view";
export const EV_UNLOCK = "playlist_unlock";
export const EV_DOWNLOAD = "playlist_download";
/** Event types only the server may write (the open legacy endpoint must refuse them). */
export const RESERVED_EVENT_TYPES: readonly string[] = [EV_VIEW, EV_UNLOCK, EV_DOWNLOAD];

export const VISITOR_COOKIE = "onfile_vid";
export const VIEW_WINDOW_MS = 30 * 60_000;
export const RECEIPT_TTL_MS = 30 * 60_000;
const RECEIPT_RE = /^[A-Za-z0-9_-]{22}$/;
const VISITOR_RE = /^[A-Za-z0-9_-]{22}$/;

const UTC_NOW = sql`(now() AT TIME ZONE 'UTC')`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const BOT_RE = /bot|crawl|spider|slurp|preview|fetch|monitor|curl|wget|python|java\/|go-http|okhttp|axios|node-fetch|headless|phantom|lighthouse|facebookexternalhit|embedly|whatsapp|skype|vkshare|pinterest|discord|quora/i;

/** Obvious automated traffic. Telegram's own link-preview fetcher ("TelegramBot") is covered by /bot/. */
export function isLikelyBot(userAgent: string | null | undefined): boolean {
  if (!userAgent || userAgent.length < 10) return true; // real browsers always send a descriptive UA
  return BOT_RE.test(userAgent);
}

function pepper(): string {
  return process.env.SETUP_TOKEN_SECRET || process.env.TELEGRAM_BOT_TOKEN || "onfile-analytics-pepper";
}

export function hashVisitor(visitorId: string): string {
  return crypto.createHmac("sha256", pepper()).update(`visitor:${visitorId}`).digest("hex").slice(0, 32);
}

export function newOpaqueId(): string {
  return crypto.randomBytes(16).toString("base64url"); // 22 chars
}

export function isReceipt(v: unknown): v is string {
  return typeof v === "string" && RECEIPT_RE.test(v);
}

// ─── Views ────────────────────────────────────────────────────────────────────

/**
 * Records ONE view for a public playlist page request (idempotent per visitor/playlist/30-min window).
 * Never throws: analytics must never break the public page. Sets the anonymous visitor cookie on `res` when needed.
 */
export async function recordPlaylistView(req: NextRequest, res: NextResponse, playlistId: number, opts: { isOwner: boolean }): Promise<boolean> {
  try {
    if (opts.isOwner) return false; // the creator previewing their own page is not an audience view
    if (req.method !== "GET") return false;
    const purpose = `${req.headers.get("purpose") ?? ""} ${req.headers.get("sec-purpose") ?? ""} ${req.headers.get("x-purpose") ?? ""}`.toLowerCase();
    if (purpose.includes("prefetch") || purpose.includes("preview")) return false;
    if (isLikelyBot(req.headers.get("user-agent"))) return false;

    let visitorId = req.cookies.get(VISITOR_COOKIE)?.value ?? "";
    if (!VISITOR_RE.test(visitorId)) {
      visitorId = newOpaqueId();
      res.cookies.set(VISITOR_COOKIE, visitorId, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
      });
    }

    if (!rateLimit(`pl-view:${getClientIp(req)}`, 120, 60_000).allowed) return false;

    const visitor = hashVisitor(visitorId);
    const bucket = Math.floor(Date.now() / VIEW_WINDOW_MS);
    const inserted = await db
      .insert(analytics)
      .values({
        playlistId,
        eventType: EV_VIEW,
        eventKey: `v:${playlistId}:${visitor}:${bucket}`,
        visitorHash: visitor,
        createdAt: UTC_NOW as unknown as Date,
      })
      .onConflictDoNothing({ target: analytics.eventKey })
      .returning({ id: analytics.id });
    return inserted.length > 0;
  } catch (err) {
    console.error("recordPlaylistView failed", err);
    return false;
  }
}

// ─── Downloads (unlock → receipt → confirmed hand-off) ─────────────────────────

/**
 * Called by POST /api/link/<slug> AFTER the file's own access check passed. Re-validates the claimed playlist context
 * from the database and, only when it is genuine, stores a 'playlist_unlock' row and returns its receipt.
 * Returns null (= "not attributable") for anything doubtful; the unlock itself is never affected by this.
 */
export async function beginPlaylistUnlock(req: NextRequest, file: { id: number; userId: number }, playlistSlug: unknown): Promise<string | null> {
  try {
    if (typeof playlistSlug !== "string") return null;
    if (isLikelyBot(req.headers.get("user-agent"))) return null;
    const pl = await findSharedPlaylist(playlistSlug); // published + valid token, else null
    if (!pl || pl.userId !== file.userId) return null;

    const user = await getSessionUser(req).catch(() => null);
    const isOwner = !!user && user.id === pl.userId;
    if (isOwner) return null; // owner testing their own delivery is not an audience download
    const unlocked = verifyUnlockToken(pl, req.cookies.get(unlockCookieName(playlistSlug))?.value);
    if (lockFor(pl, { isOwner, unlocked }) !== null) return null; // password not entered / Stars-locked → no public context

    const [member] = await db
      .select({ id: playlistFiles.id })
      .from(playlistFiles)
      .where(and(eq(playlistFiles.playlistId, pl.id), eq(playlistFiles.fileId, file.id)))
      .limit(1);
    if (!member) return null; // the file is not in that playlist → never attribute

    const receipt = newOpaqueId();
    const visitorId = req.cookies.get(VISITOR_COOKIE)?.value ?? "";
    await db.insert(analytics).values({
      fileId: file.id,
      playlistId: pl.id,
      eventType: EV_UNLOCK,
      eventKey: `u:${receipt}`,
      visitorHash: VISITOR_RE.test(visitorId) ? hashVisitor(visitorId) : null,
      createdAt: UTC_NOW as unknown as Date,
    });
    return receipt;
  } catch (err) {
    console.error("beginPlaylistUnlock failed", err);
    return null;
  }
}

/**
 * Turns the unlock row behind `receipt` into ONE confirmed download. Atomic and idempotent: the UPDATE only matches a
 * row that is still a 'playlist_unlock' (so a retry / double tap / replay matches nothing), is young enough, and
 * belongs to the file whose slug the caller claims. Returns true only for the request that actually confirmed it.
 */
export async function confirmPlaylistDownload(fileSlug: string, receipt: string): Promise<boolean> {
  const res = await db.execute(sql`
    UPDATE analytics
       SET event_type = ${EV_DOWNLOAD}, created_at = ${UTC_NOW}
     WHERE event_key = ${`u:${receipt}`}
       AND event_type = ${EV_UNLOCK}
       AND created_at > (now() AT TIME ZONE 'UTC') - (${RECEIPT_TTL_MS / 1000} * interval '1 second')
       AND file_id = (SELECT id FROM files WHERE smart_link_slug = ${fileSlug})
    RETURNING id
  `);
  return (res.rows?.length ?? 0) > 0;
}

// ─── Aggregation (Creator only — the caller has already verified ownership) ───────

export async function localToday(tz: string): Promise<string> {
  const r = await db.execute(sql`SELECT ((now() AT TIME ZONE ${tz}))::date::text AS today`);
  return String((r.rows[0] as { today: string }).today);
}

/** Earliest local date with a playlist event, or the playlist's creation date (start of "All time"). */
export async function firstActivityDate(playlistId: number, tz: string): Promise<string | null> {
  const r = await db.execute(sql`
    SELECT min(((created_at AT TIME ZONE 'UTC') AT TIME ZONE ${tz})::date)::text AS first
      FROM analytics
     WHERE playlist_id = ${playlistId} AND event_key IS NOT NULL AND event_type IN (${EV_VIEW}, ${EV_DOWNLOAD})
  `);
  return ((r.rows[0] as { first: string | null } | undefined)?.first as string | null) ?? null;
}

export interface PlaylistAnalyticsResult {
  views: { total: number; unique: number };
  downloads: { total: number };
  series: { date: string; label: string; views: number; downloads: number }[];
  insights: {
    avgDailyViews: number;
    avgDailyDownloads: number;
    bestDay: { date: string; label: string; views: number; downloads: number } | null;
    topFiles: { title: string; fileType: string | null; downloads: number }[];
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export async function getPlaylistAnalytics(playlistId: number, range: Extract<ResolvedRange, { ok: true }>, tz: string): Promise<PlaylistAnalyticsResult> {
  const local = sql`((created_at AT TIME ZONE 'UTC') AT TIME ZONE ${tz})::date`;
  const scope = sql`playlist_id = ${playlistId} AND event_key IS NOT NULL AND ${local} BETWEEN ${range.from}::date AND ${range.to}::date`;

  const dailyRes = await db.execute(sql`
    SELECT ${local}::text AS day,
           count(*) FILTER (WHERE event_type = ${EV_VIEW})::int AS views,
           count(*) FILTER (WHERE event_type = ${EV_DOWNLOAD})::int AS downloads
      FROM analytics
     WHERE ${scope} AND event_type IN (${EV_VIEW}, ${EV_DOWNLOAD})
     GROUP BY 1
  `);
  const daily = new Map<string, DailyCounts>();
  let views = 0;
  let downloads = 0;
  for (const row of dailyRes.rows as { day: string; views: number; downloads: number }[]) {
    daily.set(row.day, { views: Number(row.views), downloads: Number(row.downloads) });
    views += Number(row.views);
    downloads += Number(row.downloads);
  }

  const uniqRes = await db.execute(sql`
    SELECT count(DISTINCT visitor_hash)::int AS unique_viewers
      FROM analytics
     WHERE ${scope} AND event_type = ${EV_VIEW} AND visitor_hash IS NOT NULL
  `);
  const unique = Number((uniqRes.rows[0] as { unique_viewers: number } | undefined)?.unique_viewers ?? 0);

  const localA = sql`((a.created_at AT TIME ZONE 'UTC') AT TIME ZONE ${tz})::date`;
  const topRes = await db.execute(sql`
    SELECT f.title AS title, f.file_type::text AS file_type, count(*)::int AS downloads
      FROM analytics a
      JOIN files f ON f.id = a.file_id
     WHERE a.playlist_id = ${playlistId} AND a.event_key IS NOT NULL AND a.event_type = ${EV_DOWNLOAD}
       AND ${localA} BETWEEN ${range.from}::date AND ${range.to}::date
     GROUP BY f.id, f.title, f.file_type
     ORDER BY downloads DESC, f.title ASC
     LIMIT 5
  `);

  const g: Granularity = range.granularity;
  const series = buildSeries(range.from, range.to, g, daily).map((p) => ({ ...p, label: formatDateLabel(p.date, g) }));

  let best: { date: string; views: number; downloads: number } | null = null;
  for (const [day, c] of daily) {
    if (!best || c.views + c.downloads > best.views + best.downloads) best = { date: day, ...c };
  }

  return {
    views: { total: views, unique },
    downloads: { total: downloads },
    series,
    insights: {
      avgDailyViews: round1(views / range.days),
      avgDailyDownloads: round1(downloads / range.days),
      bestDay: best && best.views + best.downloads > 0 ? { ...best, label: formatDateLabel(best.date, "day") } : null,
      topFiles: (topRes.rows as { title: string; file_type: string | null; downloads: number }[]).map((r) => ({
        title: String(r.title),
        fileType: r.file_type ?? null,
        downloads: Number(r.downloads),
      })),
    },
  };
}
