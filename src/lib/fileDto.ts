/**
 * Safe serialisation helpers. Password hashes must NEVER leave the server:
 * clients only get `hasPassword`.
 */
export function toOwnerFile<T extends { password?: string | null }>(
  file: T,
  thumb?: { updatedAt: Date } | null
): Omit<T, "password"> & { hasPassword: boolean; hasThumbnail: boolean; thumbnailUpdatedAt: string | null } {
  const { password, ...rest } = file;
  return {
    ...rest,
    hasPassword: !!password,
    hasThumbnail: !!thumb,
    thumbnailUpdatedAt: thumb ? thumb.updatedAt.toISOString() : null,
  };
}

export function toOwnerPlaylist<T extends { password?: string | null }>(playlist: T): Omit<T, "password"> & { hasPassword: boolean } {
  const { password, ...rest } = playlist;
  return { ...rest, hasPassword: !!password };
}
