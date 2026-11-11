import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { playlists, type User } from "@/db/schema";
import { getSessionUser, isSameOriginRequest, unauthorized } from "@/lib/auth";
import { parsePositiveId } from "@/lib/playlists";
import { toPublicPlaylist } from "@/lib/playlistView";
import { getPlaylistCovers, getPlaylistFileCounts, listPlaylistFiles, statusForError, type MemberErrorCode } from "@/lib/playlistMembers";

export const NO_STORE = { "Cache-Control": "private, no-store" } as const;

type Guard = { ok: true; user: User } | { ok: false; res: NextResponse };

/**
 * Common gate for the playlist membership routes: same-origin check for
 * mutations (CSRF), session authentication. The owner is ALWAYS the session
 * user; nothing the client sends is used to decide who owns what.
 */
export async function guard(req: NextRequest, mutating: boolean): Promise<Guard> {
  if (mutating && !isSameOriginRequest(req)) {
    return { ok: false, res: NextResponse.json({ error: "Invalid request origin" }, { status: 403 }) };
  }
  const user = await getSessionUser(req);
  if (!user) return { ok: false, res: unauthorized() };
  return { ok: true, user };
}

export const idParam = (raw: string) => parsePositiveId(raw);

export async function readJsonObject(req: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function badRequest(message: string, reason = "validation_failed") {
  return NextResponse.json({ error: message, reason }, { status: 400, headers: NO_STORE });
}

export function memberError(code: MemberErrorCode, message: string) {
  return NextResponse.json({ error: message, reason: code }, { status: statusForError(code), headers: NO_STORE });
}

/** Fresh public view of an owned playlist (count + derived cover), or null. */
export async function loadPublicPlaylist(userId: number, playlistId: number) {
  const [row] = await db
    .select()
    .from(playlists)
    .where(and(eq(playlists.id, playlistId), eq(playlists.userId, userId)))
    .limit(1);
  if (!row) return null;
  const [counts, covers] = await Promise.all([getPlaylistFileCounts([playlistId]), getPlaylistCovers([playlistId])]);
  return toPublicPlaylist(row, counts.get(playlistId) ?? 0, covers.get(playlistId));
}

/** Standard success body after a membership change: refreshed playlist + its ordered files. */
export async function playlistSnapshot(userId: number, playlistId: number) {
  const [playlist, playlistFilesList] = await Promise.all([loadPublicPlaylist(userId, playlistId), listPlaylistFiles(userId, playlistId)]);
  return { playlist, files: playlistFilesList ?? [] };
}
