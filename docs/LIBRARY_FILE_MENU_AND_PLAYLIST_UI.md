# My Library file menu · icon badges · Creator Playlist page clean-up

No database migration, no new tables/columns, no analytics. One new dependency: `qrcode-generator` (MIT, zero deps, bundled types) — there was no existing QR implementation, and a correct Reed-Solomon QR encoder is not something to hand-roll.

## Creator Playlist page (`/playlists/[id]`)
- "Manage" heading removed. The list view has **no header title**: inside Telegram the native Back Button is the only back control and no header row is rendered; in a plain browser only a compact Back arrow remains. Sub-screens (Edit details, Add files, …) still show their own title.
- Top-right ⋮ menu removed. The **More** tile beside Share keeps the same menu (Edit details, Make public/private, Monetization, Share settings, Copy public link, Duplicate, Delete). Per-file ⋮ menus are untouched.
- **File requests** card removed (`PlaylistStats.tsx` deleted; the page no longer calls `/api/playlists/:id/stats`; the endpoint itself still exists, unused by this page).
- Sequential numbers (1, 2, 3 …) removed from file rows. Drag handles, thumbnails, titles, type, status badges and per-file menus, and the stored order, are unchanged.

## My Library thumbnail badges
`src/components/library/FileTypeBadge.tsx` is icon-only: Image → `Image`, Video → `Video`, Audio → `Music`, Document → `FileText`, Archive → `Archive`, other → `File`. Same top-right position, dark translucent circle (readable in light and dark themes), category-coloured icon. The label is only in `aria-label` / `title`. Filters, details and data are unchanged.

## File ⋮ menu (My Library)
Order: Edit Details · Change Thumbnail · Manage Playlists · Share · Copy Link · Generate QR Code · File Details · *(separator)* Delete File.
Menu: `LibraryMenu.tsx` (fixed-position, flips above/below, pinned + scrolls on short screens, 48px items, Arrow/Home/End/Escape, separators, destructive styling, dimmed "unavailable" items with a hint). Dialogs live in `src/components/library/file/`; all use the shared `Modal` (bottom sheet on phones, centred on desktop, scrolls when tall).

| Action | Implementation | Backend used |
|---|---|---|
| Edit Details | `EditDetailsDialog` – title (≤100, legacy longer titles allowed unchanged) + description (≤1000); sends only changed keys | existing `PATCH /api/files/:id` (now also validates description, id and body) |
| Change Thumbnail | `ChangeThumbnailDialog` wrapping the existing `ThumbnailManager` (choose → preview → Replace / Cancel / Remove) | existing `POST/DELETE /api/files/:id/thumbnail` (DBByte thumbnail storage only; originals never uploaded) |
| Manage Playlists | `ManagePlaylistsDialog` – every playlist of the creator with a membership switch, Public/Private label, file count | **new** read-only `GET /api/files/:id/playlists`; add/remove via existing `POST /api/playlists/:id/files` and `DELETE /api/playlists/:id/files/:fileId` (unique `(playlist,file)`; duplicates skipped; appended last so existing order is untouched) |
| Share | `ShareFileDialog` – link, Copy, Share on Telegram (native dialog), system share sheet, Show QR | public smart link `/f/<slug>` |
| Copy Link | clipboard (with the WebView fallback already used by playlist share) | same link |
| Generate QR Code | `QrCodeDialog` – local SVG on a white tile (scannable in both themes), title, URL, **Download QR Code** (PNG), Copy link | `src/lib/qrCode.ts` |
| File Details | `FileDetailsDialog` – category, format, size, upload / last-edit date, status, access (password / Stars), thumbnail info, views, downloads, playlist names, description | stored values only; omitted/"Not recorded" when unknown |
| Delete File | `DeleteFileDialog` – lists the playlists that lose the file, says the Telegram original is **not** deleted, loading + error states | existing `DELETE /api/files/:id` |

### Access rules
- The only link ever produced is `/f/<slug>` (`src/lib/fileShare.ts`). `GET /api/link/:slug` returns 404 for unpublished files, so a **private (unpublished) file gets no link**: Share / Copy Link / QR stay visible but dimmed ("Private — publish to share") and explain why when tapped. Password-protected files can be shared: the page still asks for the password (never part of the URL; the dialogs say so).
- `GET /api/files` no longer returns `telegramMessageLink`, `telegramFileId` or the password hash (the Library never used them); it returns `hasPassword`. Nothing in the new UI shows database ids, Telegram links or the password.

### Delete safety
Deleting from the Library removes the `files` row (existing behaviour: membership rows and the thumbnail row cascade; the thumbnail image is cleaned up best-effort). There is **no Telegram API call** anywhere on that path, so the post in the creator's channel is never touched. Playlists themselves and their other files stay. The dialog states all of this before confirmation.

## Tests
`src/components/tabs/FilesTab.fileMenu.test.tsx` (UI, 22 tests), `src/app/api/files/libraryFileActions.e2e.test.ts` (real handlers + Postgres, 10 tests), `src/lib/qrCode.test.ts`; `PlaylistPage.test.tsx` and `FilesTab.test.tsx` updated for the removed/changed elements.
