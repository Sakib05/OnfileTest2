# Unified Playlist & File Viewer

One public, same-page viewer used by both routes:

| Route | Mode | Top section | Bottom section |
|---|---|---|---|
| `/p/<share token>` (existing playlist route) | playlist | the **selected** file | the playlist's file list |
| `/f/<slug>` (existing file route) | standalone file | the file | — |

Components: `src/components/viewer/*` (`FileViewer`, `ActionRow`, `PlaylistList`, `DescriptionBlock`, `ReportDialog`, `SavedItemsWidget`, `ViewerMessage`), glue in `src/components/playlists/PublicPlaylistView.tsx` and `src/app/f/[slug]/page.tsx`.

## Layout (top → bottom)
1. Selected thumbnail (`FileHero`; steady 16:9 in playlist mode so switching doesn't make the page jump)
2. Title (`h1`)
3. Uploader — Telegram photo + **display name only** (`CreatorRow`; the `@username` is never rendered or passed to the avatar)
4. `Playlist • 13 audio` (playlist mode only; `playlistSummary` in `src/lib/viewer.ts`) and a small facts line (type · size · views · downloads, only what is known)
5. Short description — 2 lines, click to expand / collapse; nothing is rendered when there is none
6. **One** row of four buttons (`grid-cols-6`): Get File `col-span-3` (50 %), Save / Share / Report `col-span-1` each (16.67 %), icon-only with `aria-label` + `title`
7. Playlist list (playlist mode only)

No logo, no public navigation, no Previous/Next, no Telegram button. The old advertisement **card** is gone (`UnlockPanel` was deleted).

## Same-page selection
* Rows are real `<a href="/p/<token>?f=<slug>">` links, but a plain click is intercepted: `history.pushState` + state change. No navigation, no reload; modified clicks (new tab) still work.
* The selected file is `resolveSelected(items, ?f)`: the URL value is honoured **only** if it is one of the items the server returned, otherwise the first item. Unknown / malformed / unpublished slugs can't select anything.
* Refresh restores the selection from `?f=`; `popstate` re-reads it, so Back/Forward walk through earlier selections.
* The selected file's description and stats come from the existing public `GET /api/link/<slug>` (cached per file for the visit).
* Old links `/f/<slug>?list=<token>` are forwarded to `/p/<token>?f=<slug>` **only** when `GET /api/p/<token>` confirms the file is one of the visible items; otherwise they stay standalone.

## Get File (business logic unchanged)
`ActionRow` reuses `getUnlockMethods` / `requestUnlock` / `AD_SECONDS` from `src/lib/download.ts` and `POST /api/link/<slug>` untouched:
* password files → password dialog → the server verifies the password;
* everything else → the existing advertisement step (the `AD_SECONDS` countdown, shown inside the button — no card), then a second tap asks the server to authorise the file;
* only the server's successful answer reveals the Telegram delivery link (`SuccessPanel`, http(s) only);
* the access state is keyed by the selected file's slug, so selecting another file never carries an unlock over.
Stars prices are shown as an honest note (there is still no Stars payment backend).

## Save (device-local, no accounts)
`src/lib/savedItems.ts` + `useSavedItems`. `localStorage` key `onfile_saved_items_v1`.
* Playlist context → **one** entry `{type:"playlist", id:<token>}`; selecting other files never adds entries — it only refreshes that entry's `lastFile` (and never creates an entry).
* Standalone → one entry `{type:"file", id:<slug>}`.
* Stored: type, public id, title, https thumbnail URL, time, `lastFile`. Never stored: files, Telegram links/ids, passwords, unlock results. The path is re-derived on every read (`/p/<id>`, `/f/<id>`).
* Reading is defensive: bad JSON, unknown types, invalid ids, duplicates are dropped; capped at 100.
* UI (`SavedItemsWidget`): floating button appears after the first save, with a count; desktop = side drawer, mobile = bottom sheet; open, remove one, clear all (confirm), on-device explanation. Entries are plain links to the public pages, which run every normal server-side check. A playlist entry reopens `/p/<token>?f=<lastFile>` (validated again by the page).

## Share
Playlist mode → `buildShareUrl(origin, token)` = `/p/<token>`; standalone → `/f/<slug>`. Native share sheet when available, otherwise copy-to-clipboard + toast. No new link types, no Telegram URLs.

## Report
`POST /api/reports` (existing route and `reports` table, hardened):
* body `{ target: "file" | "playlist", slug, reason, details?, website? }` — public identifiers only; numeric ids are rejected;
* reasons: copyright, inappropriate, spam, broken_link, other (`inappropriate` added to the enum);
* the target is resolved server-side and must be publicly reachable (published file; shared + published playlist) else 404;
* same-origin check, 4 KB body cap, honeypot, 5 reports / 10 min / IP (in-memory limiter — same limitation as the rest of the app on serverless), 24 h de-duplication per reporter+target+reason, details cleaned and capped at 1000 chars;
* response is `{ ok: true }` only; no public listing. The dialog shows success only after a 2xx.
* In a playlist the dialog lets the visitor choose "This file" (selected) or "The whole playlist".

## Database migration
`migrations/report_targets/up.sql` (additive, idempotent): `ALTER TYPE report_reason ADD VALUE 'inappropriate'`, `reports.playlist_id`. Apply to a dev/preview database first; **Production only after explicit approval.** `src/db/schema.ts` carries the same change for `drizzle-kit push`.

## Tests
`PublicPlaylistView.test.tsx`, `app/f/[slug]/page.test.tsx`, `lib/{savedItems,viewer,reports}.test.ts`, `app/api/reports/reports.e2e.test.ts` (real handler + Postgres), plus the whole pre-existing suite.
