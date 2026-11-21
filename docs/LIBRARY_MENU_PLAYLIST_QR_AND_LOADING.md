# My Library menu simplification · Playlist QR · Library loading states

No database migration, no new tables/columns, **no new dependencies**, no analytics (Creator Playlist Analytics stays postponed; nothing analytics-related was added or changed).

## 1. My Library file ⋮ menu (`FilesTab.tsx`)
Now exactly: **Edit Details · Manage Playlists · Share · File Details · *(separator)* Delete File**.

| Removed from the menu | Where it lives now |
|---|---|
| Change Thumbnail | inside **Edit Details** |
| Copy Link | **Share** dialog → "Copy link" (unchanged component `ShareFileDialog`) |
| Generate QR Code | **Share** dialog → "Show QR code" (unchanged flow, `QrCodeDialog`) |

Share stays visible but dimmed ("Private — publish to share") for an unpublished file; its dialog explains why and offers no link, Copy or QR. Menu component, icons, 48 px items, light/dark styling and keyboard support are unchanged.

## 2. Edit Details = title + description + thumbnail (`EditDetailsDialog.tsx`)
- Same bottom-sheet/centred `Modal` as before, extended with a **Thumbnail** section (`ThumbnailManager.tsx`, now a *staged* picker).
- Choosing an image shows a local preview only. **Nothing is uploaded until "Save changes"**; **Cancel** discards everything. "Remove thumbnail" is staged the same way (with "Keep current thumbnail" to undo).
- Save = `PATCH /api/files/:id` with **only the changed keys** (title/description — never `isPublished`, password, price, slug, so a published file stays published and identifiers are preserved) **then** the existing `POST /api/files/:id/thumbnail` (or `DELETE`). Thumbnail storage is the existing DBByte pipeline; only the small optimized preview image is uploaded — never the original file; the Telegram channel post is untouched.
- Upload/delete helpers were extracted (unchanged behaviour) to `src/lib/thumbnails/clientUpload.ts` (`precheckThumbnail`, `uploadThumbnail`, `deleteThumbnail`).
- Feedback: validation messages, "Saving…" spinner, upload progress bar ("Uploading… n%", "Optimizing and saving…"), "Changes saved" toast, server errors inline.
- **Partial failure is reported honestly**: the two requests are separate endpoints. If the details save but the thumbnail fails, the details stay saved (and show in the Library at once), the dialog stays open with "Your title/description were saved, but the thumbnail wasn't: …", and Retry only repeats the thumbnail. If the details fail, the thumbnail is not uploaded.
- `ChangeThumbnailDialog.tsx` was deleted (no other users).

## 3. Playlist QR code (`ShareSheet.tsx`)
The Creator Playlist Share dialog now offers **Share playlist · Copy playlist link · Show QR code** (plus "More options…" where the OS supports it).
- **One QR implementation**: the former file-only dialog markup was moved into `src/components/ui/QrCodeModal.tsx` (on top of the existing `lib/qrCode.ts` / `qrcode-generator`) and is used by both `QrCodeDialog` (files) and `ShareSheet` (playlists). No second library.
- The QR encodes **exactly the server-issued public URL** (`POST /api/playlists/:id/share` → `/p/<token>`) that Copy/Share use, so a scan opens the same public playlist page. No extra request is made for the QR.
- Modal: playlist title, QR on a white tile (scannable in dark theme), the URL, **Download QR Code** (PNG, `onfile-qr-<title>.png`), **Copy link**, **Close** (returns to the Share options).
- Access control is unchanged and cannot be bypassed: the QR button exists **only** when the server returned a link. Private playlists (reason `private`) and unshareable paid playlists (`paid_unavailable`) show the existing explanation and **no** QR. Password-protected playlists show the existing note plus "anyone who scans this is still asked for the password"; the password is never part of the URL. The numeric id and Telegram message links are never encoded.

## 4. My Library loading (`LibraryCards.tsx` → `LibrarySkeleton`, `FilesTab.tsx`)
**Problem:** the skeleton drew 3–4 full-width `h-[108px]` / `h-[190px]` slabs, while the real Home view is rows of 168 px cards.

**Now** (`layout` prop: `"home" | "list" | "grid"`):
- *Home* (what the user actually sees first): 2 sections, each a title bar + one horizontally clipped row of 3 cards — same `w-[168px]`, same `aspect-video` thumbnail frame, same gaps (`gap-6`, `gap-3`, `-mx-4 px-4`) as `HomeSections`.
- *List / grid* (category views): results-header placeholder + 3 list cards / 4 grid cards.
- Skeleton cards reuse the real cards' `SHELL` and `THUMB_FRAME` class maps, so geometry can't drift. Placeholders use `bg-secondary` (theme token → correct in light and dark), a single pulse animation on the wrapper, disabled under `prefers-reduced-motion`. `role="status"`, `aria-busy`, screen-reader text.
- Total ≈ 6 small cards (Home) → no long scroll, the bottom navigation is never pushed or covered.

**State machine** (`FilesTab.fetchAll`):
- `loading` → skeleton, only until the **first** snapshot settles (success **or** failure). Skeleton is removed immediately when data arrives.
- Failure (non-2xx, network error, or a 20 s timeout via `AbortController`) → **"Couldn't load your library" + Retry** (`data-testid="library-error"` / `"library-retry"`). Previously a failure silently produced the empty state. Retry shows the skeleton again and re-fetches.
- Success with no data → the genuine **empty state** ("No files yet" + Upload File). Error and empty are different screens.
- Background refreshes after edit/delete/playlist changes never flip back to the skeleton and never wipe the data already shown if they fail.

## Tests
- `FilesTab.fileMenu.test.tsx` — rewritten Thumbnail section (staged preview, save together, thumbnail-only, cancel, invalid pick, staged remove, partial failure + retry without repeating the PATCH, no Change Thumbnail entry); Share section (five-item menu, Copy link and QR inside Share, password note, private blocked).
- `FilesTab.test.tsx` — five-item menu; new "loading, error and empty states" block (skeleton geometry, disappears on data, error + Retry recovery, network failure, empty).
- `PlaylistPage.test.tsx` — playlist share options, QR modal URL/title/download/copy/close, password note, private & paid → no QR.
- `qrCode.test.ts` — file-name fallback.

## Not done / limits
- Real-device / real-browser visual checks were not possible in the build sandbox (no Telegram client, no headless browser): layout was verified by markup/class assertions in jsdom and by reading the shared class maps, not by screenshots.
- A single atomic "details + thumbnail" backend call does not exist; the two existing endpoints are called in sequence (partial failures are handled as described above).
