# $10 minimum withdrawal · FAQ & Help · Privacy & Security · Terms & Conditions

No database migration. No new dependency. No change to the Telegram bot, webhook, environment variables or any production resource.

## 1. Minimum withdrawal — $10 USD

| Item | Where |
|---|---|
| Rules (exact decimal parsing, minimum, currencies/networks, address format) | `src/lib/withdrawals.ts` (shared by server + UI) |
| Server enforcement | `src/app/api/wallet/withdraw/route.ts` |
| UI (card note, dialog note, live validation, disabled submit, double-tap guard) | `src/components/tabs/WalletTab.tsx` |

**Server behaviour** (`POST /api/wallet/withdraw`, the only withdrawal entry point; Home's *Withdraw* button just opens the Wallet tab):

* Amount is parsed from its decimal text into integer micro-units (`BigInt`, 6 decimals = the `numeric(18,6)` scale). No `parseFloat`, no float comparison. Rejected: empty, `0`, negatives, `abc`, `1e3`, `0x10`, `10,5`, `.5`, `10.`, `+10`, more than 6 decimals, > 12 integer digits, NaN/Infinity, objects/arrays/booleans. Numbers (legacy clients) are accepted only when their string form is a plain decimal.
* `< $10` → `400 { code: "below_minimum", error: "Minimum withdrawal is $10 USD (10 USDT)." }`. Exactly `10` is accepted.
* Currency must be `USDT`, network one of `TRC20 | ERC20 | TON | BEP20` (exactly what the Wallet already offered; omitted values keep the old defaults `USDT`/`TRC20`). Wallet address: trimmed, 10–128 chars, no whitespace/special characters outside `A-Za-z0-9_-:.=+/`.
* One DB transaction: per-user advisory lock → duplicate check → **single conditional `UPDATE users SET balance = balance - $x, pending_balance = pending_balance + $x WHERE id = $uid AND balance >= $x`** → insert withdrawal → insert ledger row. If any step fails nothing is committed; a rejected request never touches the balance. Postgres `numeric` does the arithmetic.
* Duplicate protection: an identical request (same amount/address/network/currency) within 60 s → `409 { code: "duplicate_request" }`, nothing written. Concurrent identical requests produce exactly one withdrawal. Concurrent different requests can never overspend (balance + pending is conserved).
* Existing behaviour kept: fees (none), the "24-72 hours" text, statuses, notification (`Withdrawal requested`), `{ withdrawal }` + HTTP 201 response, same-origin check, IP rate limit, session auth.

**Existing test changed:** `src/app/api/notifications/notifications.e2e.test.ts` withdrew 5 USDT; it now withdraws 10 (the new minimum) and expects `10.00 USDT`.

**Tests**

* `src/lib/withdrawals.test.ts` — 51 unit tests (below / exactly / above $10, boundary decimals, invalid amounts, balance parsing, request validation, networks).
* `src/app/api/wallet/withdraw/withdraw.e2e.test.ts` — 14 tests against **real Postgres** and the **real route handler**: 401/403, below $10, invalid amounts, unsupported currency/network/address, exactly $10 (balance, pending, ledger, notification), exact decimals, all four networks, insufficient balance (incl. full balance), balance < $10, duplicate (409), 8 concurrent identical requests (1 created), 10 concurrent different requests on a 35 balance (exactly 3 created, balance + pending conserved), cross-user isolation. Needs a disposable database with the schema applied (like the other `*.e2e.test.ts`).
* `src/components/tabs/WalletTab.withdraw.test.tsx` — 7 jsdom tests of the form (minimum note, below $10, exactly $10, malformed/zero/negative, > balance, missing address, double submit → one request).

## 2. FAQ & Help

* Content: `src/content/faq.ts` (16 categories, 60+ entries). Search: `src/lib/faqSearch.ts`. UI: `src/components/Faq.tsx` (search box, scrollable category chips, collapsible `aria-expanded` answers, step lists, empty state, shortcuts to Privacy / Terms).
* Only features that exist today are described. Deliberately **absent** because the code has nothing for them: *End cards & recommendations*, a self-service delete-account button, live support, PayPal withdrawals, Stars checkout/paid publishing. The FAQ says so explicitly where a user might expect them.
* No earnings, revenue-rate, payment-time or file-format promises. (The Wallet dialog's pre-existing "24-72 hours" text is described only as "an estimate, not a guarantee".)
* Tests: `src/lib/faqSearch.test.ts` (content integrity + search), `src/components/Faq.test.tsx` (categories, expand/collapse, filter, search, empty, clear, links).

## 3. Privacy & Security / 4. Terms & Conditions

* Content: `src/content/legal/privacy.ts` (18 sections) and `src/content/legal/terms.ts` (23 sections). Renderer: `src/components/legal/LegalDocument.tsx` (contents list, anchored sections, draft banner, highlighted placeholders).
* Reachable from **Me › Management › Privacy & Security** and **Me › Management › Terms & Conditions**, plus links from the FAQ. Back = Telegram's native Back Button to the Me root (same as every other Me sub-page; no in-page back arrow — `noInPageBack` test still passes).
* Written from the code: originals stay in the creator's private channel; the bot requests only *Post Messages*; the bot's `copyMessage` probe goes to the creator's private chat and is deleted; what is stored (links, metadata, thumbnails in DBByte, hashed file passwords, session-token hashes, reporter IP on reports); cookies `onfile_session` / `onfile_setup` and the browser-storage keys; providers Telegram, Vercel, PostgreSQL, DBByte; no third-party analytics/ads SDK; no security certification claimed.
* **Legal details are NOT invented.** `src/config/legal.ts` holds them as `null`. While any required value is `null`, both pages show a yellow **"Draft — legal details not yet configured"** banner (listing what is missing) and print each missing value as a highlighted `[… — not configured]` placeholder.

### Must be completed before publication — `src/config/legal.ts`

| Field | Required | Notes |
|---|---|---|
| `operatorName` | yes | Legal name of the operator |
| `operatorAddress` | yes | Address you are willing to publish |
| `contactEmail` | yes | Support / privacy / deletion requests |
| `governingLaw` | yes | e.g. "the laws of …" — needs legal advice |
| `disputeVenue` | yes | courts/forum — needs legal advice |
| `effectiveDate` | yes | Date the final text takes effect |
| `privacyEmail`, `copyrightEmail` | no | Fall back to `contactEmail` |
| `databaseProvider` | no | Name the PostgreSQL host once confirmed (config notes mention Supabase; production was not inspected) |

When all required fields are set the banner disappears automatically. The text should still be reviewed by a qualified lawyer.

Tests: `src/components/legal/LegalDocument.test.tsx` (required sections, $10 minimum, no invented rates/timings/certifications, placeholder vs configured, banner, contents navigation) and `src/components/tabs/ProfileTab.legal.test.tsx` (Me rows, opening each page, FAQ ↔ Privacy ↔ Terms navigation).

## Known limitations / things noticed but intentionally not changed

* Referral Program: the UI says 5 %, but no code assigns `users.referred_by`, handles the `onfile.app/ref/<code>` link, or credits commissions. Likewise no code credits `users.balance` / `total_earnings`. The FAQ/Terms therefore promise nothing about either.
* `POST/GET /api/advertise` are unauthenticated, and `GET` returns stored campaigns (advertiser names/emails). The "Advertise with Us" page also shows hard-coded reach numbers (2.4M+ / 180K+ / 120+) that nothing in the repo supports. Not touched (out of scope) — recommend fixing.
* There is no admin path for rejecting/refunding withdrawals in this repository; statuses beyond `pending` are set outside the app.
* File delivery returns the stored `t.me` post link (see `docs/TELEGRAM_POST_VERIFICATION.md`), not a bot-forward as the README's architecture note suggests; for a private channel Telegram decides who can open it. The FAQ describes the link behaviour.
* *Contact Support* and *Language* rows in Me are still inert; there is no support channel, so none is described.
* Rate limiting is in-memory per instance (pre-existing); the duplicate/overspend protection does not depend on it (it is in the database).
* Visual checks (light/dark, narrow phones, real Telegram client) were not performed in a browser; see the delivery report.
