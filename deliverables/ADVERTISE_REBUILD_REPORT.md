# ME → Advertise rebuild — implementation report

Nothing was pushed, merged or deployed; no production variable, database or record was touched. All work was done on a local copy of
`Sakib05/OnfileTest2`. Design/behaviour details: `docs/ADVERTISING_SYSTEM.md`.

## 1. What changed

* **Replaced** the old Advertise page (contact form, ad-network dropdown, hard-coded "2.4M views / 180K users / 120 countries",
  "Supported Ad Networks" list) with a campaign dashboard, a 7-step creation wizard, a details/analytics view and an admin review page.
* `ProfileTab` navigation/routing is unchanged (`subPage === "advertise"` still opens it); the menu entry now reads "Advertise —
  Promote your files, playlists and channels" (it no longer lists ad networks). Admins also get a "Campaign Review" entry.
* Extended the **existing** `ad_campaigns` table (additive only) and added `ad_events` + `ad_conversions`.
* Rebuilt `/api/advertise` (it previously returned *every* advertiser's record to anyone and accepted unauthenticated POSTs).
* Added sponsored cards on three real surfaces (Library, file page, between playlist items).
* FAQ answer for "Advertise" updated; `FilesTab.test.tsx` adjusted (see §9).

## 2. New Advertise section structure

Dashboard (header **Advertising**, subtitle, **Create Campaign**; 6 overview metrics; status filters All/Draft/Pending Review/Active/Paused/
Completed/Rejected with counts; campaign cards) → Wizard (Type → Objective → Creative → Placements → Audience → Budget → Review → success
screen with reference) → Details (status/approval/rejection, budget/spent/remaining, impressions/clicks/CTR/verified joins, target
completion, dates, real daily + per-placement analytics or an honest empty state, ad preview).
Native Telegram Back is stacked (wizard step back / ask before discarding unsaved work / details→dashboard); wizard state is kept across
steps, auto-kept in `sessionStorage`, and can be saved as a server draft at any time.

## 3. Campaign types implemented
Promote Onfile Content (own **published** file or **shared** playlist, ownership checked server-side), Promote Telegram Channel (own connected
channel with a pasted private invite link, or another **public** channel confirmed through `getChat`), Promote Telegram Post (public channel posts).

## 4. Objectives implemented
Increase Impressions, Increase Clicks (all types), Gain Verified Channel Joins (channels only, and only when the bot is an administrator there).
**"Promote Content Access" is intentionally not offered** — Onfile cannot distinguish it from a click.

## 5. Placements actually supported
Library, File access/download page, Between playlist content, Channel join promotion (channel campaigns). **Force Join is shown as "Not available
yet" and rejected by the server** (no membership gate exists in the download flow; I did not fake it).

## 6. Wallet / payment status
**No wallet integration.** The repository's wallet only supports withdrawals (no hold/escrow), so per the brief nothing is debited, no balance is
read or changed, and there is no fake payment success. A campaign's budget is a spending cap; pricing is **not hard-coded** — an administrator sets
the unit price (cpm/cpc/cpa) and confirms the payment arrangement when approving. Until then the UI says "pending admin confirmation". Only
confirmed + approved campaigns are served; spend accrues only after a price exists and never exceeds the budget.

## 7. Admin functionality
`/admin/ads` + `/api/admin/ads` (same `ADMIN_TELEGRAM_IDS` mechanism as the storage page; verified server session; client flags ignored): review queue
with filters, creative preview, destination/targeting/schedule/budget/payment/metrics, approve (price + payment confirmation required; verified-joins
campaigns re-check the bot's admin status live), reject (reason required, shown to the creator), pause, resume, mark completed.

## 8. Database changes & migration
`migrations/ad_campaigns_v2/up.sql` / `down.sql` (+ `src/db/schema.ts`): new nullable/defaulted columns on `ad_campaigns` (public_id, user_id, ad_type,
objective, headline, description, cta_text, placements, targeting, spent, dates, pricing, payment, review/rejection, counters …), enum value `draft`,
`advertiser_name/email` relaxed to nullable, new tables `ad_events` (UNIQUE dedupe key) and `ad_conversions` (UNIQUE campaign+user). Nothing dropped or
renamed; legacy rows untouched (`user_id IS NULL`, hidden from creators). **Run manually, never automatically, against production:**
`psql "$DATABASE_URL" -f migrations/ad_campaigns_v2/up.sql`. Rollback: `down.sql` (destroys creator campaign data — back up first).
Verified here on a scratch DB created from the **original** schema with a legacy row: up.sql applied, re-ran idempotently, legacy row preserved,
down.sql restored the original columns. (Scratch DB dropped afterwards.)

## 9. Test results (exact)
* New: **83 tests, all passing** — `ads.unit.test.ts` 44, `advertise.e2e.test.ts` 30 (real Postgres + real route handlers), `Advertise.ui.test.tsx` 9.
* Full suite: **1415 passed, 48 failed, 3 skipped** (98 files). The **same 48 failures occur on the untouched original repo** (baseline: 1332 passed / 48 failed): they
  are the avatar/image tests (`avatarImage`, `avatarClient`, `AvatarCropper`) which fail in this sandbox's jsdom environment. **No new failures.**
* One existing test was changed: `FilesTab.test.tsx` "does not add per-card requests" counted every `fetch`; the Library now makes one extra,
  card-independent `/api/ads/serve` request, so the test excludes `/api/ads/*` from the count and asserts that exactly one ad request is made.
* `next typegen`: pass. `tsc --noEmit`: pass (0 errors). `npm run build`: pass. `next build` routes include all new pages/APIs.
* ESLint (`eslint .`): **11 errors / 4 warnings — identical to the untouched repo** (pre-existing `react-hooks/*` findings in other files);
  my files are lint-clean.
* `build_and_start`: see final message.

## 10. Known limitations / honesty notes
* **No real Telegram testing.** There is no bot token or Telegram client here. `getChat`/`getChatMember` logic was tested with mocked responses only;
  nothing was exercised on a device, and the UI was not visually inspected in Telegram, on Android, or in dark mode (it uses the existing theme tokens
  and `min-w-0`/wrapping to avoid overflow, but that is by construction, not by observation).
* Verified joins use on-demand `getChatMember`; campaign-specific invite links (bot lacks `can_invite_users`) and `chat_member` webhook updates are not implemented.
  Private-channel campaigns need a creator-pasted invite link; Onfile cannot prove the link belongs to the channel (admin reviews).
* Country targeting relies on the `x-vercel-ip-country` header (unknown country never matches a targeted campaign); language targeting only applies to signed-in viewers.
  Device targeting is not offered. Impressions are counted once per viewer per placement per day (anonymous viewers are hashed IP+UA, so shared IPs under-count).
* Rate limiting uses the existing per-instance in-memory limiter (not global on serverless). Serve tokens need `AD_TOKEN_SECRET` (falls back to existing secrets).
* No cron: end-date completion is applied lazily on reads/serves, so a campaign's stored status can lag until something reads it.
* Terms/Privacy text still describes the old "Advertise with Us" enquiry form; I did not rewrite legal copy — it needs review.
* Posts in private channels can't be promoted (only members could open them). No creator notification is sent on approve/reject (visible in the dashboard).
