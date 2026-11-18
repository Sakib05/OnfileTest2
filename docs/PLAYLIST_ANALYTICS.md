# Creator playlist analytics (`/playlists/[id]/analytics`)

Reached from the playlist's **More (⋯) → Analytics**. Creator-only. The management page itself shows no analytics.

## What the page shows
Exactly three headline metrics — **Views**, **Downloads**, **Earnings** — a date filter (Last 7 / 30 / 90 Days, All Time, Custom), a **Views + Downloads** line chart (one shared count axis), a **separate Earnings** section, and optional insights (average per day, best day, best performing files) that are computed from the same recorded events.

## Where the data comes from
| Metric | Source | Rule |
|---|---|---|
| Views | `analytics` rows `event_type='playlist_view'`, written by `GET /api/p/<token>` | One per anonymous visitor per playlist per **30 min**. Not counted: the owner, bots/crawlers/link-preview fetchers (UA filter), prefetches, > 120 requests/min/IP. Unique viewers = distinct HMAC'd visitor cookie. |
| Downloads | `analytics` rows `event_type='playlist_download'` | See "Downloads" below. |
| Earnings | – | **Not available.** No per-playlist revenue records exist (see "Findings"). The page says so; no number is shown. |

### Downloads — what "confirmed" can mean here
Onfile never delivers a file itself: `POST /api/link/<slug>` (after the file's own password / ad step) returns the creator's Telegram message link and **Telegram does not report back**. The strongest reliable confirmation that exists is therefore:

1. **Server-verified unlock** — `POST /api/link/<slug>` succeeded. If the request names a public playlist (`playlist: <share token>`), the server re-validates it (published, token valid, not Stars-locked, password cookie present when password-protected, file really a member of it, requester is not the owner / not a bot) and stores a `playlist_unlock` row whose random 128-bit `event_key` (`u:<receipt>`) is returned as `receipt`.
2. **Hand-off** — the visitor taps **Open in Telegram**; the viewer posts the receipt to `POST /api/link/<slug>/delivered`. One atomic `UPDATE … WHERE event_type='playlist_unlock' AND age < 30 min AND file = <slug>` turns that row into `playlist_download`.

Consequences: an unlock alone, an ad completing alone, a failed/wrong-password attempt, a page view, a replayed/duplicated/forged receipt, a receipt for another file, or an expired receipt are **never** counted; retries/double taps count once; a second genuine unlock that is opened again counts again. This is "the file link was opened in Telegram", not "Telegram confirmed receipt" — that distinction is shown in the page footnote.

### Playlist attribution
A download belongs to the playlist whose public page the visitor was on when unlocking. A file that is in several playlists is counted only for the one used. Standalone `/f/<slug>` unlocks (no playlist) are not attributed to any playlist.

## Date handling
The browser sends its IANA timezone (`tz`). "Today" comes from the database clock converted to that zone; events are grouped by their local calendar date (`created_at` is stored as UTC). Presets end today inclusive; All Time starts at the first recorded event; Custom is validated (valid dates, start ≤ end, start not in the future, not before 2020-01-01) and an end date in the future is clamped to today. Granularity: ≤ 92 days daily, ≤ 400 days weekly (Mon–Sun), longer monthly; missing days are zero points. Pure logic: `src/lib/playlistAnalyticsRange.ts`.

## API
`GET /api/playlists/:id/analytics?range=7d|30d|90d|all|custom[&from=YYYY-MM-DD&to=YYYY-MM-DD]&tz=<IANA>` — session required, ownership checked server-side (another creator's / missing playlist → identical 404, no session → 401, bad id/range/tz → 400). Returns aggregates only: no raw events, visitor hashes, Telegram ids/links, file ids, share tokens or password data.

`POST /api/link/<slug>/delivered` `{ receipt }` → `{ counted: boolean }` — public, same-origin, rate-limited; never reveals whether a receipt exists.

## Database
Migration `migrations/playlist_analytics` (additive; `up.sql` / `down.sql`): `analytics.event_key varchar(96)` (UNIQUE, nullable — idempotency), `analytics.visitor_hash varchar(64)`, index `(playlist_id, event_type, created_at)`. Legacy rows are untouched and never counted (they have no `event_key`). The old open `POST /api/analytics` now refuses the three reserved `playlist_*` event types.

## Findings that shaped the design (checked in the code, not assumed)
* `playlists.total_views`, `files.views`, `files.earnings` are never written; `files.downloads` is incremented on *unlock* (a request) — left unchanged.
* No ad-revenue ledger and no Stars payment backend exist (`src/lib/publishing/payments.ts`, `lockFor`), and `transactions` only holds withdrawals → earnings cannot be attributed to a playlist.
* The advertisement step is a 10 s client countdown in front of the server unlock (`AD_SECONDS`); there is no server-side ad-completion record in this repository.
* `/api/analytics` (dashboard) multiplies downloads by a hard-coded 0.05 — deliberately **not** reused.
