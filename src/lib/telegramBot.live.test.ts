import { describe, expect, it } from "vitest";
import { checkChannelPostExists } from "@/lib/telegramBot";

/**
 * REAL Telegram integration test (no mocks). SKIPPED unless explicitly enabled, because it needs
 * a real bot token and a real channel and sends (then deletes) one silent message in the creator's
 * private chat with the bot.
 *
 *   TELEGRAM_LIVE_TEST=1 \
 *   TELEGRAM_BOT_TOKEN=<bot token> \
 *   LIVE_TG_CHANNEL_ID=-1004447210820 \      # channel where the bot is an admin
 *   LIVE_TG_USER_ID=<your numeric Telegram id>  # you must have pressed Start in the bot chat
 *   LIVE_TG_EXISTING_MSG_ID=15 \             # a post that really exists
 *   LIVE_TG_MISSING_MSG_ID=152 \             # an id that does not exist
 *   npx vitest run src/lib/telegramBot.live.test.ts
 *
 * Use a throw-away/dev bot + channel, never production credentials.
 */
const enabled =
  process.env.TELEGRAM_LIVE_TEST === "1" &&
  !!process.env.TELEGRAM_BOT_TOKEN &&
  !!process.env.LIVE_TG_CHANNEL_ID &&
  !!process.env.LIVE_TG_USER_ID;

describe.skipIf(!enabled)("LIVE Telegram — exact post existence (real Bot API)", () => {
  const chatId = process.env.LIVE_TG_CHANNEL_ID!;
  const probeChatId = process.env.LIVE_TG_USER_ID!;
  const existing = Number(process.env.LIVE_TG_EXISTING_MSG_ID ?? 15);
  const missing = Number(process.env.LIVE_TG_MISSING_MSG_ID ?? 152);

  it("accepts a post that really exists", async () => {
    expect(await checkChannelPostExists({ chatId, messageId: existing, probeChatId })).toEqual({ ok: true });
  }, 30_000);

  it("rejects a post id that does not exist in the same channel", async () => {
    expect(await checkChannelPostExists({ chatId, messageId: missing, probeChatId })).toMatchObject({
      ok: false,
      reason: "post_not_found",
    });
  }, 30_000);

  it("rejects a channel the bot cannot access", async () => {
    const r = await checkChannelPostExists({ chatId: "-1009999999999", messageId: 1, probeChatId });
    expect(r.ok).toBe(false);
  }, 30_000);
});
