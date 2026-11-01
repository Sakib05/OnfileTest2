#!/usr/bin/env node
/**
 * One-time (or re-run-when-needed) deployment step that registers Onfile's
 * production webhook URL with Telegram via `setWebhook`, explicitly
 * including every update type the app's webhook handler
 * (src/app/api/telegram/webhook/route.ts) needs:
 *
 *   - "message"        — required for the `chat_shared` service message
 *                         produced by the native "Connect Channel via Bot"
 *                         chat picker.
 *   - "my_chat_member" — required so Telegram tells us whenever OUR BOT's
 *                         own admin status changes in a channel. This is
 *                         required for Manual Connect (there is no other way
 *                         to discover which channel a user just added the
 *                         bot to) and as a resilience fallback for "Connect
 *                         Channel via Bot".
 *
 * BUG CONTEXT: there was previously no script/automation in this repo for
 * calling `setWebhook` at all — registration had to be done by hand (e.g. a
 * one-off curl command), with no guarantee `allowed_updates` included
 * `my_chat_member`. Telegram's default (when `allowed_updates` is omitted)
 * already includes both "message" and "my_chat_member" — but if whoever
 * originally registered Onfile's webhook passed an explicit, narrower list
 * (common for a bot that started out only handling plain messages), Telegram
 * would silently stop delivering `my_chat_member` updates with no error
 * surfaced anywhere in this codebase. Running this script removes that
 * ambiguity by always setting the exact list the app actually needs.
 *
 * Usage:
 *   TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... TELEGRAM_WEBHOOK_URL=https://yourapp.example.com/api/telegram/webhook \
 *     node scripts/configure-telegram-webhook.mjs
 *
 * Safe to re-run at any time (idempotent on Telegram's side). Requires a
 * real bot token and is NOT run automatically by this project's build/start
 * — it is a deployment-time operation against the live Telegram Bot API,
 * which this sandbox has no credentials or network access to actually
 * exercise (see the delivery report's "Telegram Integration Limitations"
 * section).
 */

const botToken = process.env.TELEGRAM_BOT_TOKEN;
const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL;
const secretToken = process.env.TELEGRAM_WEBHOOK_SECRET;

if (!botToken) {
  console.error("Missing TELEGRAM_BOT_TOKEN environment variable.");
  process.exit(1);
}
if (!webhookUrl) {
  console.error("Missing TELEGRAM_WEBHOOK_URL environment variable (e.g. https://yourapp.example.com/api/telegram/webhook).");
  process.exit(1);
}
if (!secretToken) {
  console.error("Missing TELEGRAM_WEBHOOK_SECRET environment variable.");
  process.exit(1);
}

const ALLOWED_UPDATES = ["message", "my_chat_member"];

async function main() {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: secretToken,
      allowed_updates: ALLOWED_UPDATES,
      // Avoids a sudden burst of stale updates (e.g. from testing) against
      // the newly-(re)configured allowed_updates list.
      drop_pending_updates: false,
    }),
  });
  const data = await res.json();
  if (!data.ok) {
    console.error("setWebhook failed:", data.description || data);
    process.exit(1);
  }
  console.log("Webhook configured successfully with allowed_updates:", ALLOWED_UPDATES);

  const infoRes = await fetch(`https://api.telegram.org/bot${botToken}/getWebhookInfo`);
  const info = await infoRes.json();
  console.log("Current webhook info:", JSON.stringify(info.result, null, 2));
}

main().catch((err) => {
  console.error("Unexpected error configuring webhook:", err instanceof Error ? err.message : err);
  process.exit(1);
});
