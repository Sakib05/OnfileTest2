/**
 * Navigation helpers shared by My Library and the full-page Playlist screen.
 *
 * The Library sets this flag just before it navigates to /playlists/[id], so the playlist page
 * knows its previous history entry IS the Library and can use a real "back" (keeping the
 * Telegram / Android back gesture, scroll restoration and the tab state consistent). A
 * deep-linked playlist page has no flag and falls back to replacing itself with the Library.
 */
export const FROM_LIBRARY_KEY = "onfile_from_library";

export function markNavigatedFromLibrary(): void {
  try {
    sessionStorage.setItem(FROM_LIBRARY_KEY, "1");
  } catch {
    /* storage unavailable (private mode) — Back will fall back to replacing the route */
  }
}

/** Returns whether the flag was set, and clears it. */
export function consumeFromLibraryFlag(): boolean {
  try {
    const v = sessionStorage.getItem(FROM_LIBRARY_KEY) === "1";
    sessionStorage.removeItem(FROM_LIBRARY_KEY);
    return v;
  } catch {
    return false;
  }
}
