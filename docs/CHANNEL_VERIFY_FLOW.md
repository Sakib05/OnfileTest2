# Channel connection: select → immediate Verify message → Mini App verification

**Current** behaviour of the bot-guided channel connection (supersedes the "chat_shared pipeline verifies and
connects" description in `BOT_GUIDED_CONNECT.md`, `BOT_WELCOME_AND_CONFIRMATION.md` and `BOT_CHANNEL_FALLBACK.md`).

## Flow

1. **Channel Selection message** (sent with the native `request_chat` picker button — *not* the welcome message):

   ```
   📢 Please select the private Telegram channel you want to connect to your Onfile account.

   Tap the button below to select your channel 👇
   ```

   The 10-minute window is still enforced by the backend (`pending_channel_requests.expires_at`); it is just no longer
   announced in the text.
2. The user picks a channel. **Telegram** posts its own service message ("You shared … with Onfile").
3. Telegram's `chat_shared` update reaches `POST /api/telegram/webhook`. The handler does the minimum and returns:
   * one atomic `UPDATE … RETURNING` (`recordChannelSelection`) that finds the pending request for
     *(this Telegram user, this request id)*, checks it is `pending`, unclaimed, not expired and started by "Connect",
     and stores the channel id in `selected_chat_id`;
   * sends the **Channel Verification message** straight to the private chat the update came from (no lookups, no
     `getChat`/`getChatMember`/`getMe` first):

   ```
   🔐 Channel Verification

   🚀 Tap the button below to verify your connection.
   ```

   with an inline `web_app` button **Verify** → `<MINI_APP_URL>/?connect=<public request ref>`.
   It performs **no** verification, writes nothing to `channels`, and never resolves the request. `my_chat_member`
   no longer completes pending requests either (it only records bot membership / tells owners the bot lost access).
4. The user taps **Verify**. The Mini App (`ConnectionVerifyGate`) signs the Telegram user in and calls
   `POST /api/channels/connect-verify` with only `{ ref }`.
5. **Server-side verification** (`src/lib/connectVerification.ts`, the only place that connects a channel):
   authenticated Telegram identity → request belongs to that user, not expired, started and has a stored selection →
   atomic claim (`claimSelectedChannelForVerification`, returns the *stored* channel id) →
   `verifyChannelOwnershipAndBotAccess` (chat exists, is a channel, is **private**, the user is creator/admin, the bot
   is admin with the required permissions) → `finalizeVerifiedChannelConnection` → request `verified`.
6. The Mini App shows success, refreshes the dashboard and opens it. Any failure shows a clear message and never marks a
   channel as connected.

## Guarantees

| Concern | Mechanism |
| --- | --- |
| Client can't pick channel/user/verdict | Body is only the public `ref` (or the bearer `token`); channel id comes from the DB row written by the authenticated webhook; identity from session / signed setup cookie |
| Wrong user / unknown / expired request | Lookup is scoped to the authenticated Telegram user; both look like `404 expired`; the claim also requires `expires_at > now()` |
| Replay / double tap / two devices / refresh | `UPDATE … WHERE status='pending' AND claimed_at IS NULL AND selected_chat_id IS NOT NULL` — exactly one caller proceeds; resolved requests are only reported |
| Duplicate Telegram deliveries | `telegram_update_log` (same `update_id`) **and** the atomic `confirmation_sent_at` reservation → one Verify message per request |
| Failed verification | Request becomes `failed` (final); nothing connected; user told in the Mini App and the bot chat. Only a Telegram outage (`telegram_api_error`) releases the claim so Verify can be tapped again |
| Re-sharing a different channel before Verify | Replaces the stored selection of the *same* request (still one request → at most one channel, once) |
| Bot never claims "connected" early | The bot sends only the Verify prompt; success is shown by the Mini App after the server verified |

## Performance

* `chat_shared` path: dedupe insert → one `UPDATE … RETURNING` (validate + store) → one `sendMessage`. The private-chat
  bookkeeping runs concurrently with the UPDATE; the first-contact read is skipped (only `/start` needs it).
* No Bot API call precedes the message; the target chat id is taken from the update itself.
* The former fixed **3 s** delay before opening the bot chat is gone (`navigateToBotOnce` runs immediately).
* `useChannelConnect`'s 3 s status poll is **kept** deliberately: it is a read-only safety net that lets a Mini App still
  on screen learn the outcome of a verification that runs in the Mini App instance opened by Verify (visibility / focus
  signals already trigger an immediate extra check). It stops as soon as the request concludes.

## Deployment

* **Database:** apply `migrations/chat_shared_verify/up.sql` (or `npx drizzle-kit push`) *before* deploying — adds the nullable
  `selected_chat_id`, `selected_at` columns. Rollback: `down.sql`.
* **Env:** no new variables. `MINI_APP_URL` (already required) builds the Verify button.
* **Webhook:** no change; `allowed_updates` must still contain `message` and `my_chat_member`.
