# Implementation report — Library file menu, icon badges, Creator Playlist clean-up

Base: https://github.com/Sakib05/OnfileTest2 (HEAD `16944e7 "update"`), cloned, changes applied in a working copy. Nothing was pushed, merged or deployed; no production env, bot token/webhook, DB config or data was touched; no migration was added and no analytics was reintroduced. Tests ran against the sandbox's local development Postgres only.

## Implemented
**Part A – Creator Playlist page:** "Manage" heading removed (no empty header row inside Telegram; compact Back arrow only in a plain browser) · top-right ⋮ removed (native Back and the More tile beside Share kept, same menu) · File requests card removed (component deleted, page no longer calls the stats endpoint) · sequential numbers removed (drag-and-drop, handles, thumbnails, titles, categories, badges, per-file menus and stored order untouched).

**Part B – Library badges:** icon-only badges (Image, Video, Music, FileText, Archive, File), same corner/size class family, category colours kept on the icon, accessible name via `aria-label`/`title`.

**Part C/D/E – File ⋮ menu** (order as specified; Delete File separated & red; 48px items; scrolls inside the viewport; keyboard support; light/dark via theme tokens):
1. Edit Details – title/description, validation, loading, success/error, Cancel; only changed keys are PATCHed, published state/link/password/price/thumbnail/Telegram post untouched.
2. Change Thumbnail – existing `ThumbnailManager` in a dialog (preview, Replace, Cancel, Remove) → existing `/api/files/:id/thumbnail` (thumbnail storage only). Works for files with no thumbnail. The public `/f/<slug>` page reads the same stored thumbnail.
3. Manage Playlists – new read-only `GET /api/files/:id/playlists`; add/remove with the existing membership endpoints; duplicates impossible (server skip + DB unique + one-change-at-a-time UI); new files are appended so order is unchanged; private playlists labelled; no playlist creation.
4. Share – public link, copy, Telegram native share, system share sheet, QR shortcut.
5. Copy Link – `<origin>/f/<slug>` only; clear success/failure toast.
6. Generate QR Code – local SVG QR (white tile in both themes), title, URL, Download PNG, Copy link.
7. File Details – real stored values only (category, format, size, dates, status, access, thumbnail, views/downloads, playlists, description); no ids/Telegram links/password.
8. Delete File – explicit dialog listing affected playlists + "original file in Telegram is NOT deleted"; loading/error; Library updates.

**Dynamic behaviour:** private (unpublished) files keep Share / Copy Link / QR visible but dimmed with "Private — publish to share" and an explanation on tap; no link, QR or share URL is ever produced for them. Password-protected files can be shared (the page asks for the password; it is not in the URL). Manage Playlists is always available (adds when the file is in none). Editing never unpublishes.

**Hardening done on the way:** `GET /api/files` no longer returns `telegramMessageLink`, `telegramFileId` or the password hash (the Library never used them; returns `hasPassword`); `PATCH/DELETE /api/files/:id` validate the id and body and `PATCH` validates `description` (≤1000).

## Not supported / limitations (reported honestly)
- **Publishing a private file from the Library menu is not offered** (not requested); until it is published, Share/Copy/QR are unavailable and say so. (Publishing exists via the playlist page's file menu.)
- **Playlist creation** is not part of Manage Playlists (only existing playlists).
- **Edit Details never edits the Telegram message/file** (architecture doesn't support it and it was out of scope).
- **QR "Download"** uses an anchor download of a generated PNG; some Telegram in-app WebViews block downloads – the dialog then says so (screenshot/long-press fallback). Not verifiable here.
- The removed Playlist "File requests" card leaves `/api/playlists/:id/stats` in place but unused by that page.
- `Delete File` keeps the existing server rule: the file's memberships in playlists are removed with it (the dialog names the playlists first). Playlists themselves and their other files are kept.
- **Visual testing could NOT be completed**: no browser (Chromium/Playwright) exists in this sandbox. Layout, Android/desktop rendering, light/dark appearance, small screens, long titles, modal/bottom-sheet positioning and icon visibility were **not visually inspected**. They were only verified structurally (class names, theme tokens, `max-h-[90dvh]` + internal scroll, `min-h` ≥ 44px, `break-words`/`line-clamp` on titles, menu viewport clamping) via jsdom tests. Please check on a real device.
- Real Telegram clipboard / share / download behaviour was not exercised (no Telegram client).

## Tests (all run in the sandbox)
- `next typegen` ✔ · `tsc --noEmit` ✔ (empty log) · `npm run build` ✔ (new route `/api/files/[id]/playlists` listed) · `build_and_start` ✔ (health check passed).
- ESLint on all changed files: 0 errors in new/changed code. One pre-existing `react-hooks/set-state-in-effect` error remains at `FilesTab.tsx` (initial `fetchAll` on mount, unchanged original code); repo-wide `eslint .` still has the project's pre-existing errors in other files.
- Full suite `npx vitest run`: **74 files, 1056 tests, all passing** (includes DB-backed e2e tests).
- New: `FilesTab.fileMenu.test.tsx` (22) – edit validation/PATCH body/error/cancel; thumbnail preview→upload→card update, bad-file rejection; add/remove/duplicate/failure/empty for playlists; Copy Link exact URL + failure; Share (URL, copy, `t.me/share/url?url=…`); QR (encodes exact URL, title, download, copy); private files (dimmed items, no URL, no QR, nothing copied); File Details real data; Delete (confirm text, cancel, only `DELETE /api/files/:id`, no Telegram URL called, failure); menu keyboard/scroll.
- New: `libraryFileActions.e2e.test.ts` (10, real handlers + Postgres) – listing never leaks Telegram link/id/hash; PATCH keeps published/password/price/link/Telegram fields; validation; ownership/401/404; memberships (only own playlists, no duplicates, order undisturbed, file survives removal); delete removes only that file + its memberships, keeps playlist & other files, makes no Telegram fetch.
- New: `qrCode.test.ts` – QR geometry (finder patterns), determinism, SVG path coverage, filename, share-link rules.
- Updated: `PlaylistPage.test.tsx` (85 pass: no Manage heading, no header ⋮, no stats card/request, no numbers, More menu intact, drag handles kept) and `FilesTab.test.tsx` (icon badge, new menu).

## Modified / added files
Modified: `README.md`, `package.json`, `src/app/api/files/route.ts`, `src/app/api/files/[id]/route.ts`, `src/components/library/{FileTypeBadge,LibraryCards,LibraryMenu}.tsx`, `src/components/library/types.ts`, `src/components/playlists/PlaylistPage.tsx`, `src/components/playlists/PlaylistPage.test.tsx`, `src/components/playlists/manage/ManageFileRow.tsx`, `src/components/tabs/FilesTab.tsx`, `src/components/tabs/FilesTab.test.tsx`, `src/components/ui/Modal.tsx`, `src/lib/playlistMembers.ts`.
Added: `package-lock.json` (the repo had none), `docs/LIBRARY_FILE_MENU_AND_PLAYLIST_UI.md`, `deliverables/LIBRARY_FILE_MENU_REPORT.md`, `src/app/api/files/[id]/playlists/route.ts`, `src/app/api/files/libraryFileActions.e2e.test.ts`, `src/components/library/file/{EditDetailsDialog,ChangeThumbnailDialog,ManagePlaylistsDialog,ShareFileDialog,QrCodeDialog,FileDetailsDialog,DeleteFileDialog}.tsx`, `src/components/tabs/FilesTab.fileMenu.test.tsx`, `src/lib/{fileShare,qrCode}.ts`, `src/lib/qrCode.test.ts`.
Deleted: `src/components/playlists/manage/PlaylistStats.tsx`.
Dependency added: `qrcode-generator` (only; justified in the docs).
