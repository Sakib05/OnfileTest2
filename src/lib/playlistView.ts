import type { playlists } from "@/db/schema";

type PlaylistRow = typeof playlists.$inferSelect;

/**
 * Shape sent to the browser. The stored password HASH is never exposed — the
 * client only learns whether a password is set. `totalFiles` is the live count.
 */
export function toPublicPlaylist(row: PlaylistRow, fileCount: number) {
  const { password, ...rest } = row;
  return { ...rest, hasPassword: !!password, totalFiles: fileCount };
}
