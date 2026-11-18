# Creator Playlist Management UI — implementation report

Scope: UI/UX redesign of the Creator page `/playlists/[id]` (`src/components/playlists/PlaylistPage.tsx`). No backend rebuild, no duplicate systems, no schema change. The public viewer (`/p/<token>`, `/f/<slug>`) is untouched.

Work was done on a separate working copy of `https://github.com/Sakib05/OnfileTest2` (no `.git` in the ZIP; nothing pushed, merged or deployed; no Production SQL, env vars, bot tokens/webhooks or data touched). Tests ran against a disposable local dev database only.

## What was found first (existing architecture, reused)
* Playlist = ordered *references* (`playlist_files`) to the creator's files; originals stay in the creator's Telegram channel; nothing is downloaded or stored by Onfile.
* Existing, owner-scoped endpoints cover add / reorder / remove / transfer / edit / delete / share; ShareSheet and the share-token system exist; the cover is *derived* from the first file.
* Files from the connected channel reach the Library (`/api/files`) via the Create flow → that Library is the "channel file selection" workflow, so it was kept and improved rather than replaced.
* Analytics: only `files.downloads` is actually written (on `POST /api/link/:slug`, i.e. a **file request**). `playlists.total_views/total_downloads`, `files.views`, `files.earnings` are never written; `/api/analytics` fabricates earnings as `downloads × 0.05` — not reused.
* Playlist duplication did not exist; it can be done safely by composing create + add (done, with rollback).

## Delivered
* New header (Back · "Manage" · ⋮), cover with Change cover, info block from real data, four primary actions (Add Files · Preview · Share · More), compact honest analytics, redesigned file rows (handle, thumbnail, title, type, size, Published status, ⋮ menu).
* Playlist ⋮ / More menu: Edit details (title, description, cover), Make public/private, Monetization settings (password, Stars — independent switches over the existing fields), Share settings, Copy public link, Duplicate playlist, Delete (confirmation: Telegram files are not deleted).
* File menu: Preview, File settings, Move to another playlist, Publish/Unpublish (unpublish confirms), Use as playlist cover, Remove from playlist (confirms; membership only).
* Add Files: search, multi-select, select all, already-in-playlist disabled, loading skeleton, error + retry, empty-channel state (→ Create), "all already added" state, sticky Add button, success/error toasts.
* Preview opens the real `/p/<token>`; private / Stars playlists explain why there is nothing to preview and never get published by Preview.
* Accessibility: WAI-ARIA menus (existing ActionMenu), Escape closes menus/dialogs/sub-screens, dialogs now focus-trap + restore focus (`Modal`), headings receive focus on screen change, Cancel focused first in confirmations, labelled controls, `role="switch"`, ≥ 44 px touch targets, `overflow-x-hidden` + `min-w-0`/`break-words` for 320 px.
* Light/dark: only theme tokens; brand orange kept; flat (non-gradient) primary tile.

## Changed files (vs. the repository)
Modified
* `README.md` (docs index)
* `src/components/playlists/PlaylistPage.tsx` (rewritten orchestrator; same route/props; `PlaylistSummary` still exported)
* `src/components/playlists/PlaylistPage.test.tsx` (rewritten: 84 tests)
* `src/components/ui/ActionMenu.tsx` (optional trigger/menu styling props, `separated`; defaults unchanged)
* `src/components/ui/Modal.tsx` (dialog semantics, focus management; behaviour otherwise unchanged)
* `src/app/api/files/[id]/route.ts` (PATCH validates title / starsPrice / isPublished / password length only when sent)
* `src/test/noInPageBack.test.ts` (documented exception: browser-only Back button)

Added
* `src/components/playlists/manage/` — `types.ts`, `PlaylistHero.tsx`, `PlaylistStats.tsx`, `ManageFileRow.tsx`, `AddFilesView.tsx`, `EditDetailsView.tsx`, `SettingsForm.tsx`, `TransferView.tsx`, `ConfirmDialog.tsx`
* `src/lib/playlistManage.ts`, `src/lib/playlistManage.test.ts`
* `src/app/api/playlists/[id]/stats/route.ts` (read-only, owner-only)
* `src/app/api/playlists/playlistManage.e2e.test.ts`
* `docs/CREATOR_PLAYLIST_MANAGEMENT.md`, `deliverables/CREATOR_PLAYLIST_MANAGEMENT_REPORT.md`

Unchanged and intentionally untouched: `/p/[slug]`, `/f/[slug]`, `PublicPlaylistView`, viewer components, Telegram webhook/bot, channel connection, payment/ads logic, `package.json`, `tsconfig.json`, schema, migrations. `SwipeableRow` remains in the repo but this page no longer uses it.

## Test results
* Full existing + new suite (`npx vitest run`): **71 files, 1017 tests, all passing** (includes DB-backed e2e tests on a dev database).
* New: `PlaylistPage.test.tsx` 84 tests (layout, four actions, analytics, navigation incl. Telegram/browser Back, reorder + rollback + 409 + loading state, Add Files incl. duplicates/empty states, file menu actions, remove-is-membership-only, publish/unpublish rules, move, file settings validation, More menu, edit, cover, visibility, monetization, duplicate + rollback, delete, preview rules, theme/overflow guards); `playlistManage.test.ts` 7; `playlistManage.e2e.test.ts` 6 (stats ownership 401/404/400, remove keeps file + other playlists + link, cross-creator add/remove blocked, file PATCH validation and ownership).
* `npx next typegen`, `tsc --noEmit`, `npm run build`: pass. `build_and_start` (healthcheck): pass.
* Testing map: 1 owner opens page ✔ (unit) · 2 other creator blocked ✔ (e2e 404 on stats/remove/add; existing e2e for the rest) · 3–5 add files / multi / duplicates ✔ · 6 reorder persists ✔ (PUT + existing e2e) · 7 remove keeps originals ✔ · 8 publish/unpublish ✔ · 9–10 edit/visibility ✔ · 11 password/Stars settings ✔ (request bodies; payment logic untouched) · 12 share links ✔ (existing share tests retained) · 13 preview ✔ (navigates to `/p/<token>`) · 14 delete confirm ✔ · 15 themes ✔ (token audit) · 16 overflow ✔ (class-level guards) · 17–18 standalone file pages, ads, Telegram delivery ✔ (existing suites unchanged and green).

## Not performed / limitations
* **No real-browser or real-device inspection** (no browser available in this environment): desktop/mobile layout, dark theme and the Android Telegram WebView were verified by DOM/class-level tests only. Please run the Vercel *Preview* build on an Android phone before merging.
* Drag-and-drop is tested by invoking the DnD handler (jsdom has no layout engine); a physical long-press drag was not exercised.
* Preview/Share cannot work for private or Stars-priced playlists — existing product rules (no Stars payment backend); the UI explains this.
* Analytics shows only **file requests**; views, confirmed downloads, ad revenue and earnings are not recorded per playlist by the current backend, so they are omitted (stated in the UI). `/api/analytics` still contains a `downloads × 0.05` "earnings" estimate (pre-existing, not touched, not used here) — recommend reviewing it separately.
* Cover: derived from the first file by design; "Change cover" moves a file to the top. Uploading a custom cover would need a storage decision and was out of scope.
* Duplicate: copies title, description, visibility, Stars price and file order; **not** the password (only a hash is stored). Names are `Copy of <title>`.
* Inside Telegram the in-page Back arrow is intentionally hidden (native BackButton is the control, as before); the arrow shows in a plain browser. `SwipeableRow` swipe-to-remove was replaced by the ⋮ menu + confirmation.
* `PATCH /api/files/:id` now rejects invalid title/price/flag values (400) instead of storing them.

## Database migration
None required. (No schema/column/index change.)
