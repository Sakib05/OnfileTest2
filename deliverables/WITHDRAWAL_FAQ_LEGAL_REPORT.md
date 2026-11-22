# Delivery report — $10 minimum withdrawal, FAQ & Help, Privacy & Security, Terms & Conditions

Base: `https://github.com/Sakib05/OnfileTest2` @ `aec9b24`. Nothing was pushed, merged, deployed or migrated; no production variable, user data, bot setting or webhook was touched. All work and tests ran in a sandbox with a disposable local Postgres.

## Files

**Created (source):** `src/lib/withdrawals.ts`, `src/lib/faqSearch.ts`, `src/config/legal.ts`, `src/content/faq.ts`, `src/content/legal/{types,privacy,terms}.ts`, `src/components/legal/LegalDocument.tsx`
**Created (tests):** `src/lib/withdrawals.test.ts`, `src/app/api/wallet/withdraw/withdraw.e2e.test.ts`, `src/components/tabs/WalletTab.withdraw.test.tsx`, `src/lib/faqSearch.test.ts`, `src/components/Faq.test.tsx`, `src/components/legal/LegalDocument.test.tsx`, `src/components/tabs/ProfileTab.legal.test.tsx`
**Created (docs):** `docs/WITHDRAWAL_FAQ_LEGAL.md`, this report
**Modified:** `src/app/api/wallet/withdraw/route.ts`, `src/components/tabs/WalletTab.tsx`, `src/components/Faq.tsx` (rewritten; default export kept), `src/components/tabs/ProfileTab.tsx` (Privacy / Terms / FAQ wiring), `src/app/api/notifications/notifications.e2e.test.ts` (5 → 10 USDT, the new minimum), `README.md` (one docs line)
**Deleted:** none. **Dependencies:** none added/changed.

## Database

No schema change and no migration. Existing rows are untouched. (Pending withdrawals below $10 created earlier stay as they are.)

## Results

| Check | Result |
|---|---|
| `next typegen` | pass |
| `tsc --noEmit` | pass, 0 errors (baseline also 0) |
| ESLint | **11 errors + 4 warnings, identical to the untouched repo, file by file; 0 new.** (Pre-existing `react-hooks/set-state-in-effect` etc. in PerformanceChart, PublishWizard, ThumbnailField, HomeTab, ProfileTab, WalletTab, useNotifications, …) |
| Vitest (full) | **1222 passed, 3 skipped, 0 failed** (baseline 1119 passed, 3 skipped → +103 new). The 3 skipped are the pre-existing live-Telegram tests. |
| `npm run build` | pass |
| `build_and_start` | pass (`/api/health` 200) |
| Live smoke | `/` 200, unauthenticated withdraw → 401 |

Withdrawal tests (all required cases): below $10, exactly $10, above $10, insufficient balance, invalid amounts, duplicate requests, concurrent requests — the last two against the real route handler and real Postgres.

## Not tested / not claimed

* No real Telegram client, bot, webhook, DBByte, Vercel or production database was used. Telegram Mini App behaviour (native Back Button, theme) was tested only via the repo's existing mocks/jsdom tests.
* **No browser/visual pass:** light vs dark theme and narrow-phone layout were not looked at on a screen. The new screens use only the app's existing theme classes (`bg-card`, `text-primary`, `border-app`, …), a single column, ≥44 px tap targets and a horizontally scrolling chip row, but this is by construction, not by inspection.
* Legal text has not been reviewed by a lawyer.

## Legal information still to configure — `src/config/legal.ts`

`operatorName`, `operatorAddress`, `contactEmail`, `governingLaw`, `disputeVenue`, `effectiveDate` (required); `privacyEmail`, `copyrightEmail`, `databaseProvider` (optional). Until the required ones are set, the pages show a "Draft — legal details not yet configured" banner and highlighted placeholders.

## Things found in the existing code (not changed — please decide)

1. **`GET /api/advertise` is public and returns stored campaigns (advertiser names/emails); `POST` is unauthenticated.** Recommend auth/removal of the GET.
2. The "Advertise with Us" page shows hard-coded reach numbers (2.4M+, 180K+, 120+) with no source.
3. No code credits user balances/earnings, assigns `referred_by`, or serves `onfile.app/ref/<code>`; the Referral screen says "5%". FAQ/Terms promise nothing about these.
4. No withdrawal reject/refund/complete path exists in the repo (only the user-side request).
5. Delivery reveals the stored `t.me` post link, not a bot forward as the README says.
6. The "Contact Support" and "Language" rows in Me do nothing; there is no support channel, so none is described.
7. The Wallet's "24-72 hours" text and "≈ $ USD" display are pre-existing; kept, described only as estimates.
