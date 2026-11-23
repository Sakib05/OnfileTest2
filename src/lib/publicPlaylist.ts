/**
 * Server-side access rules for publicly SHARED playlists. Every decision is made here, from the database;
 * nothing the browser sends (ids, flags, "owner", "unlocked") is trusted.
 *
 * Rules:
 *  - A playlist is reachable only through its random `share_slug` AND only while `is_published` is true.
 *    Missing, unshared and private playlists all answer with the SAME 404 (nothing to probe).
 *  - Only PUBLISHED files that have a smart link are listed (an unpublished file never appears, is never counted
 *    and never provides the cover). Telegram message links are never part of any playlist response.
 *  - Password-protected playlists show only the title/description until the viewer proves the password
 *    (signed, HttpOnly cookie derived from the stored hash — a password change revokes it).
 *  - Playlists with a Stars price stay locked: there is no Telegram Stars payment backend (see
 *    src/lib/publishing/payments.ts), so a price can't be paid and the contents must not be handed out.
 *  - Each item opens through the existing /f/<slug> page, which keeps enforcing that FILE's own password/price.
 */
import crypto from "crypto";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { files, playlistFiles, playlists, users } from "@/db/schema";
import { publicCreatorColumns } from "@/db/userColumns";
import { toPublicCreator } from "@/lib/profile/serialize";
import { buildThumbnailUrl } from "@/lib/thumbnails/config";
import { getThumbnailsForFiles } from "@/lib/thumbnails/repo";
import { isValidShareSlug, type PlaylistLock, type PublicPlaylistItem, type PublicPlaylistPayload } from "@/lib/playlistSharing";

type PlaylistRow = typeof playlists.$inferSelect;

/** 96 bits of randomness, URL-safe, 16 chars. */
export function generateShareSlug(): string {
  return crypto.randomBytes(12).toString("base64url");
}

export const UNLOCK_COOKIE_MAX_AGE = 60 * 60 * 24; // 24h

export function unlockCookieName(slug: string): string {
  return `onfile_pl_${slug}`;
}

/** HMAC keyed by the STORED password hash (never exposed); changing the password invalidates every cookie. */
export function makeUnlockToken(row: Pick<PlaylistRow, "id" | "password">): string {
  return crypto.createHmac("sha256", row.password ?? "").update(`playlist-unlock:${row.id}`).digest("hex");
}

export function verifyUnlockToken(row: Pick<PlaylistRow, "id" | "password">, token: string | undefined | null): boolean {
  if (!row.password || !token) return false;
  const expected = Buffer.from(makeUnlockToken(row), "hex");
  let given: Buffer;
  try {
    given = Buffer.from(token, "hex");
  } catch {
    return false;
  }
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

/** The playlist behind a share token, only if it is currently published. Otherwise null (indistinguishable). */
export async function findSharedPlaylist(slug: string): Promise<PlaylistRow | null> {
  if (!isValidShareSlug(slug)) return null;
  const [row] = await db.select().from(playlists).where(eq(playlists.shareSlug, slug)).limit(1);
  if (!row || !row.isPublished) return null;
  return row;
}

export function lockFor(row: PlaylistRow, opts: { isOwner: boolean; unlocked: boolean }): PlaylistLock {
  if ((row.starsPrice ?? 0) > 0) return "stars"; // no payment backend → never open, not even for a stranger with a password
  if (row.password && !opts.isOwner && !opts.unlocked) return "password";
  return null;
}

/** Ordered, public-safe items. Visible position is re-numbered 1..n over what the public can actually see. */
export async function listPublicItems(row: Pick<PlaylistRow, "id" | "userId">): Promise<PublicPlaylistItem[]> {
  const rows = await db
    .select({ file: files })
    .from(playlistFiles)
    .innerJoin(files, eq(files.id, playlistFiles.fileId))
    .where(
      and(
        eq(playlistFiles.playlistId, row.id),
        eq(files.userId, row.userId), // memberships can only reference the owner's own files; re-checked anyway
        eq(files.isPublished, true),
        isNotNull(files.smartLinkSlug)
      )
    )
    .orderBy(asc(playlistFiles.position), asc(playlistFiles.id));

  const thumbs = await getThumbnailsForFiles(rows.map((r) => r.file.id));
  return rows.map(({ file: f }, i) => {
    const t = thumbs.get(f.id);
    return {
      position: i + 1,
      slug: f.smartLinkSlug as string,
      title: f.title,
      fileType: f.fileType,
      mimeType: f.mimeType,
      fileSize: f.fileSize,
      thumbnailUrl: t ? buildThumbnailUrl(t.objectKey) : null,
      hasPassword: !!f.password,
      starsPrice: f.starsPrice ?? 0,
    };
  });
}

/** Everything the public page may know. No ids, no owner id, no hashes, no Telegram links/channels. */
export async function buildPublicPayload(row: PlaylistRow, lock: PlaylistLock): Promise<PublicPlaylistPayload> {
  const [creator] = await db
    .select(publicCreatorColumns)
    .from(users)
    .where(eq(users.id, row.userId));

  const items = lock ? [] : await listPublicItems(row);
  return {
    playlist: {
      title: row.title,
      description: row.description,
      // Cover = first VISIBLE item's thumbnail (same derivation as the owner's cover, restricted to public files).
      thumbnailUrl: lock ? null : (items[0]?.thumbnailUrl ?? null),
      itemCount: items.length,
      hasPassword: !!row.password,
      locked: lock,
    },
    creator: creator ? toPublicCreator(creator) : null,
    items,
  };
}

/** Absolute origin for links handed to other people. Prefers the configured public URL, else the request's host. */
export function publicOrigin(req: Request): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured && /^https?:\/\//i.test(configured)) return configured.replace(/\/+$/, "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0].trim() ?? (host?.startsWith("localhost") ? "http" : "https");
  return host ? `${proto}://${host}` : new URL(req.url).origin;
}
