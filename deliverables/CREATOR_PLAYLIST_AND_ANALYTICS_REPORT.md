# Creator Playlist Management & Analytics — implementation report

Repository: `Sakib05/OnfileTest2` (cloned and worked on in a sandbox). **Nothing was pushed, merged, deployed or applied to Production.** All database work was against a disposable local development Postgres.

## 0. What the repository already had (reused, not rebuilt)
The earlier "Creator playlist management" work (docs/CREATOR_PLAYLIST_MANAGEMENT.md) was already in the repo: cover (derived from the first file), info block, the four-button action row (Add Files · Preview · Share · More), Add Files from the connected channel's Library, drag-and-drop reorder (dnd-kit, optimistic + rollback, 409 reload), per-file ⋮ menu (Preview, File settings, Move, Publish/Unpublish, Remove), Edit details, Visibility, Monetization (password / Stars), Share sheet, Duplicate, Delete with confirmation. All of that was kept and still goes through the same endpoints. Recharts, dnd-kit and the `analytics` table were also already present, so **no new dependency** was added.

## 1. UI changes
* **Header**: the "Manage" text and the separate top-right ⋮ menu are removed from the playlist screen. The Back button (browser only) / Telegram's native BackButton behaviour is unchanged (inside Telegram the screen has no in-page header at all). Sub-screens (Edit details, Add files, …) still name themselves with an `<h1>`.
* **More (⋯)** next to Share is untouched and is now the only playlist menu. New entry **Analytics** (chart icon) between *Share settings* and *Copy public link*.
* **Analytics removed from the management page** (the old "File requests" card and its `/api/playlists/:id/stats` route were deleted).
* **New page `/playlists/[id]/analytics`**: Back (to *that* playlist's page; native BackButton in Telegram), title "Playlist Analytics", playlist name, selected period; date filter chips (Last 7/30/90 Days, All Time, Custom with two native date inputs capped at today); exactly three metric cards (Views with unique viewers · Downloads · Earnings); a Views+Downloads line chart with legend/tooltip/dates; a separate Earnings section; insights (avg/day, best day, best files); loading skeleton, empty state, error + retry, 404 state; footnote stating the counting rules and timezone.
* The Public Viewer's layout and behaviour are unchanged. The only change there is invisible: Get File passes the playlist token, and tapping *Open in Telegram* sends the delivery confirmation.

## 2. Files
**New**
* `src/lib/playlistAnalyticsRange.ts` (+ `.test.ts`) — pure date range / timezone / bucketing logic
* `src/lib/playlistAnalytics.ts` — tracking (views, unlock receipt, confirmation) + aggregation
* `src/app/api/playlists/[id]/analytics/route.ts` — owner-only analytics API
* `src/app/api/link/[slug]/delivered/route.ts` — delivery confirmation
* `src/app/playlists/[id]/analytics/page.tsx`
* `src/components/playlists/analytics/{PlaylistAnalyticsPage,AnalyticsCharts,RangePicker}.tsx`, `types.ts`, `PlaylistAnalyticsPage.test.tsx`
* `src/app/api/playlists/playlistAnalytics.e2e.test.ts`
* `migrations/playlist_analytics/{up,down}.sql`, `docs/PLAYLIST_ANALYTICS.md`, this report

**Modified**
* `src/db/schema.ts` (two nullable columns + two indexes on `analytics`)
* `src/components/playlists/PlaylistPage.tsx` (header, no stats, Analytics menu item)
* `src/app/api/p/[slug]/route.ts` (records a view), `src/app/api/link/[slug]/route.ts` (returns a receipt when the unlock came from a valid public playlist), `src/app/api/analytics/route.ts` (refuses reserved event types)
* `src/lib/download.ts`, `src/components/viewer/ActionRow.tsx`, `src/components/download/SuccessPanel.tsx` (receipt + `onOpen`)
* Tests: `PlaylistPage.test.tsx`, `PublicPlaylistView.test.tsx`, `download.test.ts`, `playlistManage.e2e.test.ts`, `noInPageBack.test.ts`
* `docs/CREATOR_PLAYLIST_MANAGEMENT.md`, `README.md`

**Deleted**: `src/components/playlists/manage/PlaylistStats.tsx`, `src/app/api/playlists/[id]/stats/route.ts`.

## 3. Analytics architecture
Events live in the **existing `analytics` table** (no second event system). Playlist events are rows with `event_type` ∈ `playlist_view | playlist_unlock | playlist_download` and a server-generated UNIQUE `event_key`. Legacy rows have no key and are never counted; the old public `POST /api/analytics` now rejects these three types, so it can't be used to inflate numbers. Aggregation is server-side SQL (`GROUP BY` local date), the page only renders the returned aggregates.

### Views
One valid load of a public playlist page (`GET /api/p/<token>` that found a published playlist), counted once per anonymous visitor per playlist per 30-minute window (`event_key = v:<playlist>:<visitor-hash>:<bucket>`, `ON CONFLICT DO NOTHING`). The visitor id is a random HttpOnly cookie, stored only as an HMAC. Excluded: the owner's own preview, bots/crawlers/link-preview fetchers and requests without a real UA, prefetch headers, > 120 requests/min/IP. Locked (password) pages count as a page view; private/unknown playlists 404 and are never counted. A view is never a download.

### Downloads
**Important finding:** in this repository Onfile does not deliver files through the bot at request time — `POST /api/link/<slug>` returns the creator's Telegram message link and Telegram never reports back. A "confirmed Telegram delivery" signal therefore does not exist. The strongest honest signal that does exist is implemented: **(1)** a server-verified unlock that the server attributes to a public playlist issues a random receipt (`playlist_unlock` row); **(2)** the visitor tapping *Open in Telegram* posts that receipt, and one atomic `UPDATE … WHERE event_type='playlist_unlock'` turns it into `playlist_download`. Unlock-only, ad-only, failed/wrong-password attempts, page views, forged/replayed/expired/other-file receipts are never counted; retries and double taps count once. This is documented in the UI footnote as "opened in Telegram"; it is **not** a claim that Telegram confirmed receipt. If you later add bot-side delivery (`copyMessage`), the confirmation call belongs there and replaces step 2.

### Earnings
**Not available — shown as such.** `files.earnings` and `playlists.total_*` are never written, there is no ad-revenue ledger and no Stars payment backend (`lockFor` keeps Stars playlists locked; `payments.ts`), and `transactions` only holds withdrawals. Nothing can be attributed to a playlist without inventing numbers, so the card and the (separate) Earnings section say so. The dashboard's `downloads × 0.05` estimate was deliberately not reused. No currency or amount is displayed anywhere on the page.

### Attribution rule
A download belongs to the playlist whose public page the visitor was on when unlocking. The playlist token is sent with the unlock and re-validated server-side (published, valid token, not Stars-locked, password cookie present if password-protected, the file is a member, requester is not the owner or a bot). A file in several playlists is counted only for the one used; standalone `/f/<slug>` unlocks and anything doubtful get **no** receipt and are not attributed.

## 4. Date ranges
Browser timezone (`tz`) is validated against IANA zones; "today" comes from the DB clock in that zone; events are grouped by local date. Presets end today (inclusive); All Time starts at the first recorded event; Custom is validated and clamped (future end → today; future/reversed/pre-2020 start → 400 with a message). Granularity: ≤ 92 days daily, ≤ 400 weekly (Mon–Sun), else monthly; gaps are zero points. Verified: UTC 23:30 lands on the next day for `Asia/Dhaka`.

## 5. Database migration
`migrations/playlist_analytics/up.sql` (additive, idempotent) adds `analytics.event_key varchar(96)` (unique, nullable), `analytics.visitor_hash varchar(64)` and index `(playlist_id, event_type, created_at)`. Why: idempotency (retries cannot inflate counts) and unique viewers; the table otherwise already had everything needed. `down.sql` drops the columns/indexes (with a note on deleting the new event rows first). Existing rows are untouched. Tested on a dev DB (`drizzle-kit push`, then the whole suite). **Not applied to Production** — apply `up.sql` there only after your approval, before deploying this code (the new routes/inserts need the columns).

## 6. Security
* Ownership enforced server-side on every analytics request (session user must own the playlist; other creator's/missing playlist → same 404; no session → 401). Id/range/tz validated; tz and dates never reach SQL unparameterised.
* Response contains aggregates only — verified by test: no raw events, visitor hashes, Telegram ids/links, file ids, share tokens, password data.
* Receipts are 128-bit random, single-use, file-bound, 30-minute lifetime; `/delivered` is same-origin checked, rate-limited and never reveals whether a receipt exists.
* Share tokens, public/private rules, password and Stars rules, ownership checks, Telegram delivery and the bot/channel code were not modified. Public pages never expose Telegram links beyond what the existing unlock flow already returned.

## 7. Tests actually performed
| Check | Result |
|---|---|
| Existing suite before changes (against a migrated dev DB) | 71 files, 1017 tests passed |
| Full suite after changes (`npx vitest run`) | **74 files, 1067 tests passed** (includes real-Postgres e2e) |
| `next typegen` | passed |
| `tsc --noEmit` | passed (no errors) |
| `npm run build` | passed (new routes `/playlists/[id]/analytics`, `/api/playlists/[id]/analytics`, `/api/link/[slug]/delivered` listed) |
| ESLint on touched areas | no errors in new/changed files (17 pre-existing errors/warnings remain in untouched files, e.g. `useNotifications`, `PublishWizard`) |
| HTTP integration against the production build (`next start`, seeded dev data) | pages 200, `/playlists/abc/analytics` 404, API 401/200, 7d/all-time aggregates correct, repeated anonymous loads with the same cookie = 1 view |
| `build_and_start` (bootstrap + health check) | see final run |

New tests: range/bucketing unit tests; real-handler e2e for views (dedupe, owner/bot/prefetch exclusion, private 404), downloads (unlock ≠ download, idempotency, expiry, forged/other-file receipts, wrong password, attribution across playlists, standalone, password playlist, legacy endpoint injection), API (ownership, privacy of payload, ranges, future dates, timezone, weekly aggregation); component tests for the analytics page (three metrics only, no earnings figure, chart/legend, empty/error/404 states, presets, custom range validation, Back → same playlist, native Back); management-page tests (no "Manage", no header menu, no analytics, Analytics item); viewer tests (receipt flow). Removing a file keeps the file/Telegram link/other playlists (existing e2e, retained).

### Not performed (be aware)
* **No real browser / device testing.** A Chromium download succeeded, but the sandbox lacks the system libraries (no root) so it could not launch. Mobile/desktop layout, light/dark themes, chart readability, menu positioning and Telegram Mini App viewport behaviour were **not visually verified**; they were built with responsive classes (wrapping chips, 1-column metric cards under 420 px, `min-w-0`/`overflow-x-hidden`, 224 px chart) and checked only through jsdom tests and HTML/API probes. Please check on an Android Telegram client.
* Telegram bot connection/verification, Stars payments and the advertisement step were not exercised beyond the existing automated tests (this repository has no Stars payment backend and only a client-side 10 s ad countdown in front of the server unlock; this differs from the "two-ad / server-side ad verification" described in the task, and none of it was changed).

## 8. Known limitations
* Downloads mean "file link opened in Telegram from this playlist"; Telegram gives no receipt confirmation. Users who copy the Telegram link instead of tapping the button are not counted (under-count, never over-count).
* Earnings are unavailable until a per-playlist revenue ledger exists.
* Views dedupe relies on a cookie; a browser that blocks cookies is counted as a new visitor on each 30-minute window per request.
* `playlist_unlock` rows for unlocks that are never opened stay in the table (never counted); a cleanup job can delete them after 30 minutes.
* Deleting a playlist leaves its analytics rows (harmless, unreachable).
* "Change cover" still means choosing the first file (the repo has no cover upload/storage, and none was added). Playlists have no category field, so none is shown. "Duplicate playlist" reuses the existing safe client-side duplication (same file references, no Telegram files copied).
* Old `files.downloads`/dashboard numbers are unchanged and measure *unlock requests*.
