# Creator playlist management page (`/playlists/[id]`)

A dashboard-style workspace for one playlist. It is **separate from the public viewer** (`/p/<token>`, `/f/<slug>`), which it only links to and which is unchanged.
Everything goes through the existing, session-scoped endpoints; ownership is enforced server-side (the client never sends an owner id).

## Layout (top → bottom)
1. **Header** – *(updated)* no "Manage" text and no top-right ⋮ menu on the playlist screen. Sub-screens show only their own name (Edit details, Add files, …). The single playlist menu is the **More** tile in the action row.
   *Back*: inside Telegram the native BackButton is the back control (the in-page arrow is hidden to avoid two arrows); in a plain browser the page renders its own Back button. Escape leaves a sub-screen; focus moves to the new screen's heading.
2. **Cover** – the derived cover (first file's thumbnail) or the default art, with **Change cover**.
3. **Info** – title, description, `Public/Private`, file count, total size (sum of the sizes that exist; shown as `245 MB+` when some files have no recorded size; hidden when none), Password / Stars chips, and a note when some files are not published.
4. **Primary actions** (one 4-column row, ≥ 60 px tall on phones): **Add Files** (filled brand colour) · **Preview** · **Share** · **More**.
5. *(removed)* Analytics no longer appear on this page — they live on **More → Analytics** (`/playlists/[id]/analytics`, see `PLAYLIST_ANALYTICS.md`).
6. **Files** – drag handle · position · thumbnail/type art · title · type · size · Published/Not published · ⋮ menu.

## Operations and the endpoints they use (no new backend systems)
| UI | Endpoint |
|---|---|
| Add Files (multi-select, search, select all) | `GET /api/files` (the Library = files from the connected channel) → `POST /api/playlists/:id/files` (by reference; server skips members and rejects foreign ids) |
| Reorder / "Use as cover" | `PUT /api/playlists/:id/files` (optimistic, rollback, 409 reload) |
| Remove from playlist (confirmation) | `DELETE /api/playlists/:id/files/:fileId` – membership row only |
| Move / also add to another playlist | `POST /api/playlists/:id/files/:fileId/transfer` |
| Publish / Unpublish file (unpublish asks first) | `PATCH /api/files/:id { isPublished }` |
| File settings (title, password, Stars) | `PATCH /api/files/:id` |
| Edit details, Visibility, Monetization (password, Stars) | `PATCH /api/playlists/:id` |
| Share / Copy link / Share settings | `POST /api/playlists/:id/share` + the existing `ShareSheet` |
| Preview | `POST /api/playlists/:id/share` → `router.push("/p/<token>")` (the real public page) |
| Duplicate | `POST /api/playlists` then `POST /api/playlists/:newId/files` (same file references, same order, visibility + Stars copied, **password not copied**); a half-built copy is deleted again on failure |
| Delete (confirmation: Telegram files are not deleted) | `DELETE /api/playlists/:id` |
| Analytics | More → Analytics → `/playlists/:id/analytics` page → `GET /api/playlists/:id/analytics` (owner-only; replaces the old `/stats` route, which was removed) |

## Cover
Covers are derived (`getPlaylistCovers`); there is no cover upload or storage. "Change cover" therefore means *choose which file is first* – done with the existing reorder endpoint and explained in the UI.

## Preview rules
* Opens the real `/p/<token>`; password, Stars and ad requirements are enforced there, not bypassed.
* A **private** playlist has no public page (404 for everyone): Preview explains this and opens the Share dialog; it never publishes anything.
* A **Stars-priced** playlist cannot be shared yet (existing 409 `paid_unavailable`), so there is nothing to preview; the UI says so.
* Browser/Telegram Back returns to this page.

## Analytics
Moved to its own page — see `docs/PLAYLIST_ANALYTICS.md`. The management page shows no analytics cards, charts or counters.

## Changed shared pieces
* `ActionMenu` – optional `triggerClassName`, `triggerContent`, `menuClassName`, item `separated` (defaults unchanged).
* `Modal` – `role="dialog"`, `aria-modal`, focus moved into the dialog, Tab trapped, focus restored on close (additive; Escape/backdrop behaviour unchanged).
* `PATCH /api/files/:id` – validates `title`, `starsPrice` (0…10 000), `isPublished`, password length **only when those keys are sent** (previously unvalidated).
* `src/test/noInPageBack.test.ts` – `PlaylistPage.tsx` added to the documented exceptions (browser-only Back).
* `SwipeableRow` is no longer used by this page (removal is in the ⋮ menu behind a confirmation, so a swipe/drag can't remove anything); the component and its tests remain.

## Database
No migration. No schema change.
