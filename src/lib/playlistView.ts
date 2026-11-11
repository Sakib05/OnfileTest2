import type { playlists } from "@/db/schema";
import type { PlaylistCover } from "@/lib/playlistMembers";

type PlaylistRow = typeof playlists.$inferSelect;

/**
 * Shape sent to the browser. The stored password HASH is never exposed — the
 * client only learns whether a password is set. `totalFiles` is the live count.
 * `thumbnailUrl` is DERIVED from the playlist's first file (see
 * getPlaylistCovers); it is never stored, so it can't go stale. null → the UI
 * shows the default playlist image.
 */
export function toPublicPlaylist(row: PlaylistRow, fileCount: number, cover?: PlaylistCover | null) {
  const { password, ...rest } = row;
  return { ...rest, hasPassword: !!password, totalFiles: fileCount, thumbnailUrl: cover?.thumbnailUrl ?? null };
}
