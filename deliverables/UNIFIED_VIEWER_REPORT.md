# Implementation report — Unified Playlist & File Viewer

Base: `https://github.com/Sakib05/OnfileTest2` (HEAD `48a3aa8`), cloned in full and modified in place. Nothing was pushed, merged or deployed; no Production database or environment variable was touched.
Design/behaviour reference: `docs/UNIFIED_PLAYLIST_FILE_VIEWER.md`.

## What changed

**New**
- `src/components/viewer/` — `FileViewer`, `ActionRow`, `PlaylistList`, `DescriptionBlock`, `ReportDialog`, `SavedItemsWidget`, `ViewerMessage`
- `src/lib/savedItems.ts`, `src/lib/useSavedItems.ts` (device-local saves), `src/lib/viewer.ts` (selection/URL/summary helpers), `src/lib/reports.ts` (reasons + validation shared by dialog and API)
- `migrations/report_targets/{up,down}.sql`
- Tests: `PublicPlaylistView.test.tsx` (rewritten), `app/f/[slug]/page.test.tsx` (rewritten), `lib/savedItems.test.ts`, `lib/viewer.test.ts`, `lib/reports.test.ts`, `app/api/reports/reports.e2e.test.ts`
- `docs/UNIFIED_PLAYLIST_FILE_VIEWER.md`, this report

**Modified**
- `src/components/playlists/PublicPlaylistView.tsx` — now the same-page playlist viewer (route `/p/<token>` kept)
- `src/app/f/[slug]/page.tsx` — standalone mode of the same viewer; forwards legacy `?list=` links when safe
- `src/components/download/CreatorRow.tsx` (photo + display name only), `FileHero.tsx` (steady 16:9 option)
- `src/app/api/reports/route.ts` (hardened, slug-based, playlist target), `src/db/schema.ts` (`inappropriate` reason, `reports.playlist_id`)
- `src/lib/download.ts` (optional `fileSize`, optional `id`), `src/lib/playlistSharing.ts` (comments), `README.md`, a file list in `PlaylistPage.test.tsx`

**Removed**: `UnlockPanel.tsx` (the advertisement card UI), `ReportModal.tsx` (replaced), `PlaylistNavBar.tsx` + test (Previous/Next is out of scope), `playlistContext.test.tsx`.
The sandbox's blank starter files (`drizzle.config.json`, placeholder `src/`) were replaced by the repository's own (`drizzle.config.ts`, full `src/`).

## Requirement → implementation
| Spec | Done |
|---|---|
| A. same-page viewer, URL kept, refresh, Back/Forward | `pushState` to `/p/<token>?f=<slug>`, `popstate` listener, selection validated against server-listed items |
| B. exact layout, one 50/16.67/16.67/16.67 row, no logo/nav | `grid-cols-6`, `col-span-3` + three `col-span-1`; icon-only with `aria-label`/`title`; no header |
| C. ad card removed, logic kept | card gone; Get File runs the same countdown → server authorisation flow (`lib/download.ts` and `POST /api/link/<slug>` untouched) |
| D. Save rules | playlist = ONE entry by token, file = one entry by slug, drawer/bottom-sheet, count, remove, clear, on-device note, defensive parsing |
| E. Share | playlist link `/p/<token>` or `/f/<slug>`, native share or copy |
| F. Report | dialog with 5 reasons, optional details, file/playlist choice, success only after 2xx; hardened endpoint |
| G. Description | 2-line preview, click to expand/collapse, missing → nothing |
| H. List | thumbnail/type icon, title, type · size, selected state; no Previous/Next, no Telegram button |
| I. Standalone | same viewer without playlist parts |
| J. Security | see below |

## Security notes
- Selection is purely presentational. The playlist payload (unchanged server code) only contains files the server allows; locked playlists return no items and the page ignores `?f=`; unknown/hidden slugs fall back to the first visible item.
- Get File always asks the server (`POST /api/link/<slug>`); password / published checks are unchanged. Access state resets per selected file.
- Saved items hold public identifiers only; paths are re-derived; no Telegram ids/links/files/passwords.
- Reports: public slugs only, server-side resolution of publicly reachable targets, same-origin, size cap, honeypot, rate limit, de-duplication, no data echoed, no listing.
- The uploader `@username` is never rendered. (It is still present in the existing public JSON of `/api/link/<slug>` and `/api/p/<token>`, as before; I did not change those payloads.)

## Findings you should know about (not changed — scope rule "do not change advertisement business rules")
1. **There is no "two-ad policy" and no server-side ad-completion verification in this repository.** The existing flow is a client-side 10-second countdown (`AD_SECONDS`, "Ad space / Powered by Adsgram" placeholder) followed by `POST /api/link/<slug>`, which checks only the password and the published flag. I preserved exactly that. If a two-ad policy with server verification lives in another branch / the production deployment, it needs to be provided; it can be wired in inside `ActionRow` (`onGetFile` / `submit`) without UI changes.
2. "Telegram file delivery" in this repo = the server returns `telegramMessageLink` and the page shows `SuccessPanel` ("Open in Telegram"). Kept as is; it appears only after the server authorises the selected file.
3. Telegram Stars checkout does not exist yet (`lib/publishing/payments.ts`); a price is shown as an honest note and never unlocks anything — as before.
4. The rate limiter is in-memory (per instance), as for every other endpoint here.
5. The reference screenshot was not available to me; the layout follows the written specification.

## Verification (run in this sandbox)
- `npx next typegen`, `tsc --noEmit`, `npm run build` — pass.
- Full vitest suite against the local Postgres (schema pushed with `drizzle-kit push`): **69 files / 983 tests**; all pass. In one full parallel run one pre-existing timing-sensitive test (`directConnect.e2e` "persistent outage is retried") failed under load and passed when re-run alone (26/26).
- Live smoke on the running production build: `/p/<token>?f=…` and `/f/<slug>` return 200; `POST /api/reports` → 201 for file and playlist targets, 403 for a cross-origin request. Smoke data was removed afterwards.
- Automated UI tests cover: in-place selection, list stays visible, no router navigation, refresh restore, malformed/unknown `?f=`, Back/Forward, one playlist saved entry (and none from selection), standalone save, drawer open/remove/clear, malformed storage, playlist/standalone share links, report success/failure/429, Get File countdown → server call for the SELECTED file, password and Stars behaviour, locked playlists, theme-token usage and overflow-safe classes.
- **Not verifiable here:** pixel-level visual QA in real browsers (no browser in the sandbox) — please check the 320px-wide mobile layout, light/dark themes and Telegram in-app browser on a real device in a Preview deployment.

## Deploying
1. Apply `migrations/report_targets/up.sql` to a Preview/dev database (or `npx drizzle-kit push`). Production only after your approval.
2. Deploy to Preview, run the manual checklist above, then promote.
