# Creator Advertising System (ME → Advertise)

The old "Advertise with Us" enquiry form is replaced by a self-service campaign dashboard. This document describes how it
works, what is deliberately **not** claimed, and how to operate it.

## Structure

| Area | Files |
| --- | --- |
| UI (creator) | `src/components/advertise/` — `AdvertiseSection` (root), `AdvertiseDashboard`, `CampaignCard`, `CampaignDetails`, `wizard/CampaignWizard` + `wizard/steps` + `wizard/state` |
| Ad surfaces | `src/components/ads/SponsoredSlot.tsx`, used by `FilesTab` (library), `FileViewer` (file access) and `PlaylistList` (between items) |
| Admin UI | `src/app/admin/ads/page.tsx` (link appears in ME for admins only) |
| Creator API | `GET/POST /api/advertise`, `GET/PATCH /api/advertise/[ref]`, `POST /api/advertise/[ref]/action`, `GET /api/advertise/options`, `POST /api/advertise/resolve` |
| Serving/tracking API | `GET /api/ads/serve`, `POST /api/ads/event`, `POST /api/ads/join` |
| Admin API | `GET/POST /api/admin/ads` |
| Domain logic | `src/lib/ads/*` (constants, validation, transitions, metrics, tokens, targeting, destination, telegram, events, join, service, adminService, repo, serialize) |
| Schema | `src/db/schema.ts` (`ad_campaigns` extended; new `ad_events`, `ad_conversions`) + `migrations/ad_campaigns_v2/{up,down}.sql` |

`ProfileTab` keeps its sub-page routing (`subPage === "advertise"`) and now renders `<AdvertiseSection />`. Telegram's native Back
button is stacked: the wizard steps backwards (and asks before dropping unsaved work), details returns to the dashboard, the dashboard
returns to ME.

## Lifecycle

```
draft ──submit──▶ pending (Pending Review) ──approve──▶ active ⇄ paused ──▶ completed
  ▲                        └──reject──▶ rejected ──reopen──▶ draft
```

* Creators: submit, pause, resume (only if *they* paused it), reopen a rejected campaign, delete a draft.
* Admins: approve (requires unit price + payment confirmation), reject (requires a reason), pause, resume, mark completed.
* Automatic completion (evaluated server-side when counters change, and lazily on reads/serves for end dates):
  target reached, budget exhausted, end date passed.
* Every change is a conditional `UPDATE … WHERE status = <expected>` — double taps and races cannot apply a transition twice.

## What can and can't be measured

| Objective | Offered for | Measured by |
| --- | --- | --- |
| Increase Impressions | all types | `ad_events` impression, unique per viewer / placement / day |
| Increase Clicks | all types | `ad_events` click, unique per viewer / day |
| Gain Verified Channel Joins | Telegram channels **only when the bot is an administrator of the channel** (checked live on resolve, submit and approval) | `ad_conversions` (see below) |

"Promote Content Access" is **not** offered: Onfile cannot tell it apart from a click, and unmeasurable objectives are not sold.

### Verified joins
1. `start` (server): `getChatMember` baseline. Already a member → recorded as `already_member`, **never** counted. Not a member → `awaiting_join`.
2. The destination opens (Telegram invite/channel link).
3. `verify` (server): `getChatMember` again; only an `awaiting_join` baseline can become `verified`.
4. `UNIQUE (campaign_id, user_id)` + a conditional update make it impossible to count a user twice; the first baseline is kept, so
   leaving and re-joining doesn't convert an existing member. Telegram errors never count as "member" **or** "not a member".

Membership updates: the webhook also handles Telegram `chat_member` updates (`src/lib/ads/join.ts → confirmJoinFromUpdate`). A not-a-member →
member change only counts for a user who has an `awaiting_join` baseline for an active verified-joins campaign of that chat, through the same
conditional transition as the on-demand check (so it can never double count). `scripts/configure-telegram-webhook.mjs` now requests
`chat_member` in `allowed_updates` — **re-run it (manually, per environment)**; Telegram only delivers `chat_member` for chats where the bot is an administrator.

Not implemented: campaign-specific invite links (the bot only holds `can_post_messages`, not `can_invite_users`; the creator's own invite link
is used when provided). Attribution is therefore "baseline taken when the viewer first met the join prompt in Onfile + membership confirmed
afterwards", never a click.

## Placements

Implemented and selectable: **Library**, **File access / download page**, **Between playlist content** (after the 3rd item),
**Channel join promotion** (channel campaigns only; shown on the file page).
**Force join** — see below.

### Force join (members-only unlock of ONE file)
* Channel campaign + placement `force_join` + the creator's own published file (stored in `ad_campaigns.file_id`; **no schema change**).
  Must use the *Verified Channel Joins* objective, a channel where the bot is an administrator, and can't be mixed with other placements.
* Nothing is gated until an admin approves (pending/paused/rejected/completed/over-budget/out-of-date campaigns gate nothing).
  Approval re-checks: gated file still the owner's published file, bot can still verify, and no other active gate on the same file.
* Enforcement is server-side in `POST /api/link/<slug>`: live `getChatMember`; not a member → 403 `join_required`, no Telegram link returned;
  Telegram outage → 503 (**fails closed**); anonymous (no Telegram session) → 403 `login_required`. File owner and campaign owner are never gated.
  Only the gated file is affected; other files, playlists and screens are untouched.
* UI: `ActionRow` asks `POST /api/link/<slug>/gate {action:"start"}` on the first Get File tap (also records the already-a-member baseline);
  `ForceJoinGate` shows Join (opens the validated t.me link) and "I've joined" (server re-check via `action:"verify"`). Tapping Join never unlocks or counts.
* Difference from *Channel join*: channel join is an optional card on the file page; force join is a mandatory gate on one file's access.
* Content Access objective: still not offered (a click/unlock isn't distinguishable from other traffic without a real signal).

## Pricing & payment (no fabricated numbers, no silent debits)

* No price is hard-coded. A campaign's budget is a **spending cap**. On approval an administrator sets the **unit price**
  (cpm / cpc / cpa follows from the objective) and confirms the payment arrangement. Until then pricing reads "pending admin confirmation".
* The repository has no wallet hold/escrow mechanism (the wallet only supports withdrawals). Therefore **no wallet balance is read or
  changed by this feature.** `payment_status` is `pending_confirmation` → `confirmed` (admin). Only confirmed, active, in-date,
  in-budget campaigns are served. If a wallet hold is built later, it must be server-side, authenticated, atomic, idempotent and auditable.
* Spend accrues only for the priced event type, only after a price exists, and never beyond the budget.

## Security notes

* Creator identity always comes from the server session; campaigns are queried by `user_id = session user` (other creators' references answer 404).
* Creators address campaigns by public reference (`AD-XXXXXXXX`); numeric ids, owner ids and reviewer ids are not returned.
* Clients cannot set status, spend, counters, pricing, payment, reviewer or owner: those keys are not part of the validated input.
* Impressions/clicks need a signed, expiring serve token (HMAC; secret `AD_TOKEN_SECRET`, falling back to `SETUP_TOKEN_SECRET` / `TELEGRAM_BOT_TOKEN`).
  Duplicates are rejected by a unique database key; creators' own views are ignored.
* Destinations are only Onfile paths (`/f/<slug>`, `/p/<slug>`) or `https://t.me` links, validated on save, on submit and again before navigation.
  External channels/posts are confirmed with Telegram (`getChat`) but ownership is never assumed — an admin reviews every campaign.
* Text is plain text only (`< >` rejected, rendered by React as text). No custom image URLs are accepted; thumbnails come from Onfile's own storage.
* Admin endpoints require `requireAdmin` (verified session + `ADMIN_TELEGRAM_IDS`).
* Rate limits use the existing in-memory limiter (per instance — not global on serverless; see `src/lib/rateLimit.ts`).

## Operating it

1. Apply the migration (manually, never automatically against production): `psql "$DATABASE_URL" -f migrations/ad_campaigns_v2/up.sql`
   (local/dev: `npx drizzle-kit push`). Rollback: `migrations/ad_campaigns_v2/down.sql` (destroys creator campaigns — back up first).
2. Make sure `ADMIN_TELEGRAM_IDS` lists the reviewers, `TELEGRAM_BOT_TOKEN` is set, and (recommended) set `AD_TOKEN_SECRET`.
3. Admins review at **ME → Campaign Review** (`/admin/ads`).

## Legacy data

Existing `ad_campaigns` rows are untouched (`user_id IS NULL`). They are not shown to creators and only counted in the admin page.
`advertiser_name` / `advertiser_email` were relaxed to nullable (existing values kept). The old `GET /api/advertise`
(public list of every enquiry) no longer exists. The Terms/Privacy texts still describe the old enquiry form — have them reviewed.

## Tests (additions for force join)

* `src/app/api/link/forceJoin.e2e.test.ts` — real Postgres + real routes: ownership, approval, enforcement, outage fail-closed, existing members never counted, one count per user, owner bypass, unrelated files, pause lifts the gate, `chat_member` updates.
* `src/components/viewer/ForceJoinGate.test.tsx`, and force-join cases in `ads.unit.test.ts`.

## Tests

* `src/lib/ads/ads.unit.test.ts` — validation, budgets, dates, XSS, placements, transitions, CTR, completion rules, tokens, targeting, destination ownership and URL safety, Telegram membership logic.
* `src/app/api/advertise/advertise.e2e.test.ts` — real Postgres + real route handlers: auth, creator isolation, idempotent create, draft editing, submission, admin authorization, approve/reject, analytics, de-duplication, budget exhaustion, target completion, join conversions (single count, existing members, concurrency, outages).
* `src/components/advertise/Advertise.ui.test.tsx` — dashboard, status actions, wizard step flow, honest pricing copy, sponsored slot behaviour.
