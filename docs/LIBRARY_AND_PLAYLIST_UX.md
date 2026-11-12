# Library & Playlist UX iteration

Branch: `feature/library-playlist-ux` (never `main`). No backend, schema or migration changes.

## 1. Library search alignment — `src/components/library/LibrarySearch.tsx`
The field is now **one flex row** `[search icon][input][close]` styled as the field (border, background, focus ring on
`:focus-within`). The icon and the close button are normal flex children — nothing is absolutely positioned over a padded
input — so the placeholder always starts after the icon, on small Android screens too (`min-w-0` lets the input shrink,
the placeholder truncates instead of clipping). The browser's own ✕ for `type=search` is hidden so only our close button
exists. Matching logic (`filterByQuery` in `src/lib/library.ts`) is untouched: files **and** playlists.

## 2. File-type tag on the thumbnail — `src/components/library/FileTypeBadge.tsx`
Rendered inside the thumbnail frame (`relative overflow-hidden`) at `top-1.5 right-1.5`, so it is attached to the artwork in
List, Grid and Home-row cards. Translucent dark pill + white text (readable on any image / `FileTypeArt`, light and dark
theme) with a small per-category colour dot. The old chip below the thumbnail was removed. The Stars price chip stays below.

## 3. Relative upload time — `src/lib/relativeTime.ts`, `src/components/library/RelativeTime.tsx`
* Source: the file's existing `createdAt` (`files.created_at`, the record-creation/upload time) from the one
  `/api/files` snapshot — **no extra query per card**, no modification time used.
* Output: `Just now`, `5 minutes ago`, `2 hours ago`, `Yesterday`, `3 days ago`, `2 weeks ago`, `1 month ago`, `1 year ago`.
* Timezone-safe: based on elapsed time between two absolute instants. A zone-less DB string is read as **UTC** (the column is
  a UTC `timestamp`), never as viewer-local time. Future skew → `Just now`.
* Missing / invalid timestamp → nothing is rendered (no invented value, no crash).
* One shared 60 s clock re-renders the labels so they never go stale. The `<time>` element carries the real ISO instant and a
  full-date tooltip. Playlists show no upload time (decision: not needed for the design).

## 4. "Thumbnail" removed from the file ⋯ menu — `src/components/tabs/FilesTab.tsx`
Menu is now `Open Link · Share · Analytics · Delete`. The menu-only state and modal were removed. **Unchanged:** thumbnail
display + `FileTypeArt` fallback, the Publish-wizard thumbnail upload, `/api/files/[id]/thumbnail`, `/api/thumbnails`, DBByte
objects and DB rows. `src/components/ThumbnailManager.tsx` is intentionally kept (now unreferenced) so the capability can be
re-attached elsewhere without re-writing it.

## 5. Playlist = full page — route `src/app/playlists/[id]/page.tsx`, UI `src/components/playlists/PlaylistPage.tsx`
* Clicking a playlist card (Home row, List, Grid) or *View posts* / *Edit* in its menu calls `router.push('/playlists/:id')`
  (`?edit=1` opens the edit form). The old modal (`PlaylistManager`) was replaced by this page.
* Data comes from the **existing** session-scoped APIs: `GET /api/playlists` (+ `/api/playlists/:id/files`). Ownership checks
  stay server-side; unknown/foreign ids show a "Playlist not found" state.
* Layout: Back · 16:9 cover (derived server-side from the first ordered file's thumbnail, default art otherwise) · title ·
  description · file count · *Add files from Library* + *Edit* · ordered file list · *Delete playlist*.
* Navigation: in-page Back, Telegram's native **BackButton** (`src/lib/useTelegramBackButton.ts`, also what the Android back
  gesture triggers inside a Mini App). Back from a sub-screen (add / edit / move) returns to the playlist first. The Library sets
  a `sessionStorage` flag (`src/lib/playlistNav.ts`) so Back uses real history (`router.back()`); a deep link falls back to
  `router.replace('/')`. Active tab (`files`) lives in `AppProvider` (root layout) so it survives the navigation.
* Add-to / move-to another playlist (multi-playlist membership) is kept: **tap a file row** → choose *Add* or *Move*.

## 6. Swipe-to-remove — `src/components/playlists/SwipeableRow.tsx`, maths in `src/lib/swipe.ts`
* The ⋯ menu on playlist rows is gone. Swiping a row **right-to-left** slides it left and reveals a red *Remove* panel (92 px) on
  the right.
* Pointer Events (touch + mouse + pen). `touch-action: pan-y` keeps vertical scroll native; the first ≥ 8 px decide the axis
  (`lockAxis`: horizontal must beat vertical by 1.2×), so scrolling never moves a row. Release settles by distance (≥ 40 % of the
  panel) or flick velocity (≥ 0.45 px/ms); anything else springs back. `pointercancel` restores the rest state. Rubber-band past
  fully-open. The click that ends a swipe is swallowed; tapping an open row only closes it.
* Drag-and-drop reorder is unaffected: the handle is `data-no-swipe` and remains the only dnd-kit activator.
* Only one row is open (state lives in the page); starting a swipe elsewhere, pressing outside, or starting a drag closes it.
* Remove = `DELETE /api/playlists/:id/files/:fileId` (membership only — never `/api/files`, never the thumbnail, never other
  playlists). The row, count and cover update **immediately** (optimistic); on failure the row/count/cover are restored and an
  error toast is shown. No extra confirmation: the swipe + tap is already a deliberate two-step action.
* Accessibility: the Remove button is always in the accessibility tree, labelled `Remove <title> from playlist`, focusable; focusing it
  reveals it. `ArrowLeft` opens / `ArrowRight` or `Escape` closes while focus is in the row.

## Tests
`npx vitest run` (Vitest + jsdom): `relativeTime.test.ts`, `swipe.test.ts`, `PlaylistPage.test.tsx` (replaces `PlaylistManager.test.tsx`),
`FilesTab.test.tsx` (extended). jsdom has no layout engine and no real touch input: geometry (non-overlap of icon/placeholder,
badge corner) is verified through DOM structure / classes, and gestures through synthetic pointer events. **Real Android / Telegram
device testing was NOT performed.**
