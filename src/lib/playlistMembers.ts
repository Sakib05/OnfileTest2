/**
 * Playlist membership service (server-side only).
 *
 * A playlist is an ordered list of REFERENCES to a creator's existing files
 * (`playlist_files`). Nothing in here ever deletes a row from `files`, touches
 * a Telegram message, or touches a thumbnail object: removing a file from a
 * playlist, moving it, or deleting the whole playlist only changes membership
 * rows. The same file may be a member of any number of playlists.
 *
 * Safety rules enforced for EVERY operation (callers pass the authenticated
 * `userId` from the session — never a client-supplied owner):
 *   - the playlist(s) must be owned by `userId`,
 *   - every file must be owned by `userId`,
 *   - source membership must exist for remove / move,
 *   - multi-row changes run in one transaction that first locks the affected
 *     playlist rows (`FOR UPDATE`, in id order → no deadlocks), so concurrent
 *     add / remove / reorder / move requests serialise instead of interleaving,
 *   - (playlist_id, file_id) is unique in the database, so a duplicate can never
 *     be stored even under a race.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { fileThumbnails, files, playlistFiles, playlists } from "@/db/schema";
import { buildThumbnailUrl } from "@/lib/thumbnails/config";
import { getThumbnailsForFiles } from "@/lib/thumbnails/repo";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export const MAX_FILES_PER_REQUEST = 200;

export type MemberErrorCode =
  | "playlist_not_found"
  | "destination_not_found"
  | "file_not_found"
  | "not_member"
  | "same_playlist"
  | "order_mismatch";

export type Outcome<T extends object = object> = ({ ok: true } & T) | { ok: false; code: MemberErrorCode; message: string };

const fail = (code: MemberErrorCode, message: string): { ok: false; code: MemberErrorCode; message: string } => ({ ok: false, code, message });

/** HTTP status for a failed outcome. */
export function statusForError(code: MemberErrorCode): number {
  switch (code) {
    case "same_playlist":
      return 400;
    case "order_mismatch":
      return 409;
    default:
      return 404; // not found / not yours / not a member — indistinguishable on purpose
  }
}

/** Parses a client-supplied list of file ids; null when malformed. Order is preserved, duplicates rejected. */
export function parseFileIds(raw: unknown): number[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_FILES_PER_REQUEST) return null;
  const out: number[] = [];
  const seen = new Set<number>();
  for (const v of raw) {
    if (typeof v !== "number" || !Number.isInteger(v) || v <= 0 || v > 2147483647 || seen.has(v)) return null;
    seen.add(v);
    out.push(v);
  }
  return out;
}

// ─── internals ────────────────────────────────────────────────────────────────

/** Locks the given playlists (owned by userId) in id order. Returns the ids that exist AND are owned. */
async function lockOwnedPlaylists(tx: Tx, userId: number, ids: number[]): Promise<Set<number>> {
  const uniq = [...new Set(ids)].sort((a, b) => a - b);
  const rows = await tx
    .select({ id: playlists.id })
    .from(playlists)
    .where(and(inArray(playlists.id, uniq), eq(playlists.userId, userId)))
    .orderBy(asc(playlists.id))
    .for("update");
  return new Set(rows.map((r) => r.id));
}

async function nextPosition(tx: Tx, playlistId: number): Promise<number> {
  const res = await tx.execute(sql`select coalesce(max("position"), -1)::int + 1 as next from "playlist_files" where "playlist_id" = ${playlistId}`);
  return Number((res.rows[0] as { next: number }).next);
}

/** Clears the legacy single-playlist pointer when it points at the playlist the file just left. */
async function clearLegacyPointer(tx: Tx, userId: number, fileId: number, playlistId: number) {
  await tx
    .update(files)
    .set({ playlistId: null })
    .where(and(eq(files.id, fileId), eq(files.userId, userId), eq(files.playlistId, playlistId)));
}

/**
 * Self-healing copy of legacy `files.playlist_id` values into `playlist_files`
 * (same statement as migrations/playlist_files/up.sql). Idempotent and cheap;
 * guarantees that data created before the multi-playlist change shows up even if
 * only `drizzle-kit push` (schema, no backfill) was applied. Never throws.
 */
export async function backfillLegacyMemberships(userId: number): Promise<void> {
  try {
    await db.execute(sql`
      insert into "playlist_files" ("playlist_id", "file_id", "user_id", "position", "created_at")
      select f."playlist_id", f."id", f."user_id",
             coalesce((select max(pf."position") + 1 from "playlist_files" pf where pf."playlist_id" = f."playlist_id"), 0)
               + (row_number() over (partition by f."playlist_id" order by f."created_at", f."id") - 1)::int,
             coalesce(f."created_at", now())
      from "files" f
      join "playlists" p on p."id" = f."playlist_id" and p."user_id" = f."user_id"
      where f."user_id" = ${userId}
        and f."playlist_id" is not null
        and not exists (select 1 from "playlist_files" x where x."playlist_id" = f."playlist_id" and x."file_id" = f."id")
      on conflict ("playlist_id", "file_id") do nothing
    `);
  } catch (err) {
    console.error("playlist_backfill_failed", err instanceof Error ? err.message : "unknown_error");
  }
}

// ─── reads ────────────────────────────────────────────────────────────────────

export interface PlaylistCover {
  /** Public URL of the FIRST file's thumbnail; null → show the default playlist image. */
  thumbnailUrl: string | null;
  firstFileId: number | null;
}

/**
 * Cover of each playlist = thumbnail of its first file (lowest position). If the
 * first file has no thumbnail the cover is null (default image) — we deliberately
 * do NOT fall through to a later file. Pure read; never throws.
 */
export async function getPlaylistCovers(playlistIds: number[]): Promise<Map<number, PlaylistCover>> {
  const map = new Map<number, PlaylistCover>();
  if (playlistIds.length === 0) return map;
  try {
    const rows = await db
      .selectDistinctOn([playlistFiles.playlistId], {
        playlistId: playlistFiles.playlistId,
        fileId: playlistFiles.fileId,
        objectKey: fileThumbnails.objectKey,
      })
      .from(playlistFiles)
      .leftJoin(fileThumbnails, eq(fileThumbnails.fileId, playlistFiles.fileId))
      .where(inArray(playlistFiles.playlistId, playlistIds))
      .orderBy(asc(playlistFiles.playlistId), asc(playlistFiles.position), asc(playlistFiles.id));
    for (const r of rows) {
      map.set(r.playlistId, { thumbnailUrl: r.objectKey ? buildThumbnailUrl(r.objectKey) : null, firstFileId: r.fileId });
    }
  } catch (err) {
    console.error("playlist_cover_failed", err instanceof Error ? err.message : "unknown_error");
  }
  return map;
}

export async function getPlaylistFileCounts(playlistIds: number[]): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  if (playlistIds.length === 0) return map;
  const rows = await db
    .select({ playlistId: playlistFiles.playlistId, n: sql<number>`count(*)::int` })
    .from(playlistFiles)
    .where(inArray(playlistFiles.playlistId, playlistIds))
    .groupBy(playlistFiles.playlistId);
  for (const r of rows) map.set(r.playlistId, r.n);
  return map;
}

export interface PlaylistFileView {
  id: number;
  title: string;
  fileType: string | null;
  mimeType: string | null;
  fileSize: number | null;
  isPublished: boolean | null;
  smartLinkSlug: string | null;
  starsPrice: number | null;
  hasPassword: boolean;
  position: number;
  thumbnailUrl: string | null;
  thumbnailWidth: number | null;
  thumbnailHeight: number | null;
}

/** Ordered contents of a playlist, or null when the playlist doesn't exist / isn't the caller's. */
export async function listPlaylistFiles(userId: number, playlistId: number): Promise<PlaylistFileView[] | null> {
  const [pl] = await db
    .select({ id: playlists.id })
    .from(playlists)
    .where(and(eq(playlists.id, playlistId), eq(playlists.userId, userId)))
    .limit(1);
  if (!pl) return null;
  await backfillLegacyMemberships(userId);

  const rows = await db
    .select({ file: files, position: playlistFiles.position })
    .from(playlistFiles)
    .innerJoin(files, eq(files.id, playlistFiles.fileId))
    .where(and(eq(playlistFiles.playlistId, playlistId), eq(files.userId, userId)))
    .orderBy(asc(playlistFiles.position), asc(playlistFiles.id));

  const thumbs = await getThumbnailsForFiles(rows.map((r) => r.file.id));
  return rows.map(({ file: f, position }) => {
    const t = thumbs.get(f.id);
    return {
      id: f.id,
      title: f.title,
      fileType: f.fileType,
      mimeType: f.mimeType,
      fileSize: f.fileSize,
      isPublished: f.isPublished,
      smartLinkSlug: f.smartLinkSlug,
      starsPrice: f.starsPrice,
      hasPassword: !!f.password,
      position,
      thumbnailUrl: t ? buildThumbnailUrl(t.objectKey) : null,
      thumbnailWidth: t?.width ?? null,
      thumbnailHeight: t?.height ?? null,
    };
  });
}

// ─── writes ───────────────────────────────────────────────────────────────────

/** Appends files (from the caller's library) to a playlist. Existing members are skipped, never duplicated. */
export async function addFilesToPlaylist(
  userId: number,
  playlistId: number,
  fileIds: number[]
): Promise<Outcome<{ added: number[]; alreadyMembers: number[] }>> {
  return db.transaction(async (tx) => {
    const locked = await lockOwnedPlaylists(tx, userId, [playlistId]);
    if (!locked.has(playlistId)) return fail("playlist_not_found", "Playlist not found.");

    const owned = await tx
      .select({ id: files.id })
      .from(files)
      .where(and(inArray(files.id, fileIds), eq(files.userId, userId)));
    const ownedIds = new Set(owned.map((r) => r.id));
    // All-or-nothing: a single foreign/unknown id fails the whole request.
    if (fileIds.some((id) => !ownedIds.has(id))) return fail("file_not_found", "One or more files weren't found in your library.");

    const existing = await tx
      .select({ fileId: playlistFiles.fileId })
      .from(playlistFiles)
      .where(and(eq(playlistFiles.playlistId, playlistId), inArray(playlistFiles.fileId, fileIds)));
    const existingIds = new Set(existing.map((r) => r.fileId));
    const toAdd = fileIds.filter((id) => !existingIds.has(id));

    let pos = await nextPosition(tx, playlistId);
    const added: number[] = [];
    for (const fileId of toAdd) {
      const inserted = await tx
        .insert(playlistFiles)
        .values({ playlistId, fileId, userId, position: pos })
        .onConflictDoNothing()
        .returning({ fileId: playlistFiles.fileId });
      if (inserted.length > 0) {
        added.push(fileId);
        pos += 1;
      }
    }
    await tx.update(playlists).set({ updatedAt: new Date() }).where(eq(playlists.id, playlistId));
    return { ok: true as const, added, alreadyMembers: fileIds.filter((id) => !added.includes(id)) };
  });
}

/** Removes ONE membership. The file itself, its thumbnail and its other playlists are untouched. */
export async function removeFileFromPlaylist(userId: number, playlistId: number, fileId: number): Promise<Outcome> {
  return db.transaction(async (tx) => {
    const locked = await lockOwnedPlaylists(tx, userId, [playlistId]);
    if (!locked.has(playlistId)) return fail("playlist_not_found", "Playlist not found.");

    const removed = await tx
      .delete(playlistFiles)
      .where(and(eq(playlistFiles.playlistId, playlistId), eq(playlistFiles.fileId, fileId), eq(playlistFiles.userId, userId)))
      .returning({ id: playlistFiles.id });
    if (removed.length === 0) return fail("not_member", "That file isn't in this playlist.");

    await clearLegacyPointer(tx, userId, fileId, playlistId);
    await tx.update(playlists).set({ updatedAt: new Date() }).where(eq(playlists.id, playlistId));
    return { ok: true as const };
  });
}

/**
 * Persists a new order. `orderedFileIds` must be exactly the playlist's current
 * members (a permutation); if someone else changed the playlist in the meantime
 * the request is refused with `order_mismatch` (409) so the client can reload.
 */
export async function reorderPlaylist(userId: number, playlistId: number, orderedFileIds: number[]): Promise<Outcome> {
  return db.transaction(async (tx) => {
    const locked = await lockOwnedPlaylists(tx, userId, [playlistId]);
    if (!locked.has(playlistId)) return fail("playlist_not_found", "Playlist not found.");

    const current = await tx.select({ fileId: playlistFiles.fileId }).from(playlistFiles).where(eq(playlistFiles.playlistId, playlistId));
    const currentIds = new Set(current.map((r) => r.fileId));
    if (currentIds.size !== orderedFileIds.length || orderedFileIds.some((id) => !currentIds.has(id))) {
      return fail("order_mismatch", "This playlist changed. Please reload it and try again.");
    }

    const values = sql.join(orderedFileIds.map((id, i) => sql`(${id}::int, ${i}::int)`), sql`, `);
    await tx.execute(sql`
      update "playlist_files" as pf set "position" = v.pos
      from (values ${values}) as v(file_id, pos)
      where pf."playlist_id" = ${playlistId} and pf."file_id" = v.file_id and pf."user_id" = ${userId}
    `);
    await tx.update(playlists).set({ updatedAt: new Date() }).where(eq(playlists.id, playlistId));
    return { ok: true as const };
  });
}

/**
 * "add"  → the file stays in the source playlist AND is appended to the destination.
 * "move" → the file leaves the source playlist and is appended to the destination.
 * Either way the original file row stays untouched in the library.
 */
export async function transferFile(
  userId: number,
  fromPlaylistId: number,
  toPlaylistId: number,
  fileId: number,
  mode: "add" | "move"
): Promise<Outcome<{ mode: "add" | "move"; alreadyInDestination: boolean }>> {
  if (fromPlaylistId === toPlaylistId) return fail("same_playlist", "Choose a different playlist.");
  return db.transaction(async (tx) => {
    const locked = await lockOwnedPlaylists(tx, userId, [fromPlaylistId, toPlaylistId]);
    if (!locked.has(fromPlaylistId)) return fail("playlist_not_found", "Playlist not found.");
    if (!locked.has(toPlaylistId)) return fail("destination_not_found", "Destination playlist not found.");

    const [file] = await tx.select({ id: files.id }).from(files).where(and(eq(files.id, fileId), eq(files.userId, userId))).limit(1);
    if (!file) return fail("file_not_found", "File not found in your library.");

    const [member] = await tx
      .select({ id: playlistFiles.id })
      .from(playlistFiles)
      .where(and(eq(playlistFiles.playlistId, fromPlaylistId), eq(playlistFiles.fileId, fileId)))
      .limit(1);
    if (!member) return fail("not_member", "That file isn't in this playlist.");

    const pos = await nextPosition(tx, toPlaylistId);
    const inserted = await tx
      .insert(playlistFiles)
      .values({ playlistId: toPlaylistId, fileId, userId, position: pos })
      .onConflictDoNothing()
      .returning({ id: playlistFiles.id });

    if (mode === "move") {
      await tx.delete(playlistFiles).where(and(eq(playlistFiles.playlistId, fromPlaylistId), eq(playlistFiles.fileId, fileId)));
      await clearLegacyPointer(tx, userId, fileId, fromPlaylistId);
    }
    await tx.update(playlists).set({ updatedAt: new Date() }).where(inArray(playlists.id, [fromPlaylistId, toPlaylistId]));
    return { ok: true as const, mode, alreadyInDestination: inserted.length === 0 };
  });
}

/**
 * Deletes the playlist and its membership rows ONLY. Files are never deleted:
 * they stay in the library and in every other playlist that references them.
 */
export async function deletePlaylist(userId: number, playlistId: number): Promise<Outcome<{ detachedFiles: number }>> {
  return db.transaction(async (tx) => {
    const locked = await lockOwnedPlaylists(tx, userId, [playlistId]);
    if (!locked.has(playlistId)) return fail("playlist_not_found", "Playlist not found.");

    const removed = await tx.delete(playlistFiles).where(eq(playlistFiles.playlistId, playlistId)).returning({ id: playlistFiles.id });
    // Legacy pointer: never leave a file pointing at a playlist that no longer exists.
    await tx.update(files).set({ playlistId: null }).where(and(eq(files.playlistId, playlistId), eq(files.userId, userId)));
    await tx.delete(playlists).where(and(eq(playlists.id, playlistId), eq(playlists.userId, userId)));
    return { ok: true as const, detachedFiles: removed.length };
  });
}

/** Appends a freshly published file to a playlist inside the publish transaction. */
export async function appendMembershipInTx(tx: Tx, userId: number, playlistId: number, fileId: number): Promise<void> {
  const pos = await nextPosition(tx, playlistId);
  await tx.insert(playlistFiles).values({ playlistId, fileId, userId, position: pos }).onConflictDoNothing();
}
