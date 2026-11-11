# Playlist management, file-type visuals, 2 MiB thumbnails

## A. Playlists
* **Data model** — new additive table `playlist_files(playlist_id, file_id, user_id, position, created_at)` with
  `UNIQUE(playlist_id, file_id)` (no duplicates, even under races) and `ON DELETE CASCADE` to both parents.
  A membership is a *reference*: one `files` row (one Telegram post, one thumbnail) can sit in any number of playlists.
  `files.playlist_id` is **kept** (never dropped/rewritten) as a legacy column.
* **Migration** — `migrations/playlist_files/up.sql` (idempotent: creates the table and copies existing
  `files.playlist_id` links, oldest first) / `down.sql` (drops only the new table). `npx drizzle-kit push` also creates the table;
  because push cannot backfill, the app additionally self-heals: `backfillLegacyMemberships()` copies any not-yet-migrated link
  the first time a playlist is listed. **Not run against production** — run `up.sql` on a preview/staging DB first.
* **API** (all: session auth, same-origin check on mutations, ownership of playlist(s) *and* files re-verified server-side, 404 for foreign ids):
  * `PATCH /api/playlists/:id` — name / description (existing, unchanged)
  * `GET /api/playlists/:id/files` — ordered contents
  * `POST /api/playlists/:id/files {fileIds}` — add (all-or-nothing ownership check; existing members skipped)
  * `PUT /api/playlists/:id/files {fileIds}` — persist order (must be exactly the current members, else 409)
  * `DELETE /api/playlists/:id/files/:fileId` — remove membership only
  * `POST /api/playlists/:id/files/:fileId/transfer {toPlaylistId, mode: "add"|"move"}`
  * `DELETE /api/playlists/:id` — removes the playlist + membership rows only
  * `PATCH /api/files/:id` no longer accepts `playlistId` (membership has its own endpoints).
* **Concurrency** — every multi-row change is one transaction that first `SELECT … FOR UPDATE`s the affected playlist rows in id order.
* **Cover** — derived at read time from the first file's thumbnail (`getPlaylistCovers`); nothing is stored or copied. First file without a
  thumbnail, or an empty playlist → default playlist image (`PlaylistThumb`).
* **UI** — `src/components/playlists/PlaylistManager.tsx` (opened from the Library playlist card): edit, add from Library (multi-select),
  drag-and-drop (dnd-kit; mouse/touch/keyboard sensors, drag only from the handle, `touch-action:none`, actions locked while dragging/saving),
  per-file "Add to another playlist" / "Move to another playlist" / "Remove from playlist", delete with confirmation.

## B. File-type visuals
`src/lib/fileKinds.ts` (central mapping: extension → mime → coarse DB enum → `other`) and
`src/components/ui/FileTypeArt.tsx` (inline SVG, gradient tiles defined in `globals.css`, dark-theme adjustment, no external assets).
Kinds: PDF, Word, Excel, PowerPoint, document, image, video, audio, archive, APK, other. The emoji helper `getFileTypeIcon` was removed.

## C. Thumbnail limit
2 MiB (2,097,152 bytes) defined once in `src/lib/thumbnails/limits.ts`; used by both pickers, the browser compressor
(`imageCompress.ts`: progressive re-encode, guarantees ≤ 2 MiB or shows an error), both upload routes and `processThumbnail`.
Exactly 2 MiB is accepted, 2 MiB + 1 byte is rejected (413) by the server independently. DBByte flow unchanged.

## Environment variables
No new variables. (DBByte variables are unchanged.)

## Known limitations
* Drag-and-drop was verified at the logic level in jsdom (drag-end handler, sensors, persistence) and through the real API; it was **not**
  exercised in a real touch browser/device in this environment.
* Playlist order is per-playlist; the public smart-link page (`/f/[slug]`) is per file and does not show playlists.
* `package.json` has no `test` script; run `npx vitest run`.
