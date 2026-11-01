import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { botChannelAdminEvents } from "@/db/schema";
import { findRecentAdminDiscoveryForUser, recordBotChannelAdminEvent } from "@/lib/botChannelEvents";

const TEST_CHAT_ID = "-1009999999001";
const TEST_USER_ID = 900_000_002;

async function cleanup() {
  await db.delete(botChannelAdminEvents).where(eq(botChannelAdminEvents.telegramChatId, TEST_CHAT_ID));
}

beforeEach(cleanup);
afterAll(cleanup);

describe("botChannelEvents — my_chat_member discovery store (Bug 1 fix)", () => {
  it("records a bot-promoted-to-administrator event and makes it discoverable", async () => {
    await recordBotChannelAdminEvent({
      telegramChatId: TEST_CHAT_ID,
      telegramUserId: String(TEST_USER_ID),
      chatTitle: "My Private Channel",
      chatUsername: null,
      isChannel: true,
      botStatus: "administrator",
      canPostMessages: true,
    });

    const discovery = await findRecentAdminDiscoveryForUser(TEST_USER_ID, 60_000);
    expect(discovery).toBeTruthy();
    expect(discovery?.telegramChatId).toBe(TEST_CHAT_ID);
    expect(discovery?.chatTitle).toBe("My Private Channel");
  });

  it("does not surface a discovery for a non-administrator status (e.g. bot only added as member)", async () => {
    await recordBotChannelAdminEvent({
      telegramChatId: TEST_CHAT_ID,
      telegramUserId: String(TEST_USER_ID),
      chatTitle: "My Private Channel",
      chatUsername: null,
      isChannel: true,
      botStatus: "member",
      canPostMessages: false,
    });

    const discovery = await findRecentAdminDiscoveryForUser(TEST_USER_ID, 60_000);
    expect(discovery).toBeUndefined();
  });

  it("does not surface a discovery outside the recency window", async () => {
    await recordBotChannelAdminEvent({
      telegramChatId: TEST_CHAT_ID,
      telegramUserId: String(TEST_USER_ID),
      chatTitle: "My Private Channel",
      chatUsername: null,
      isChannel: true,
      botStatus: "administrator",
      canPostMessages: true,
    });
    await db
      .update(botChannelAdminEvents)
      .set({ updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000) })
      .where(eq(botChannelAdminEvents.telegramChatId, TEST_CHAT_ID));

    const discovery = await findRecentAdminDiscoveryForUser(TEST_USER_ID, 30 * 60 * 1000);
    expect(discovery).toBeUndefined();
  });

  it("does not surface a discovery for a different telegram user", async () => {
    await recordBotChannelAdminEvent({
      telegramChatId: TEST_CHAT_ID,
      telegramUserId: String(TEST_USER_ID),
      chatTitle: "My Private Channel",
      chatUsername: null,
      isChannel: true,
      botStatus: "administrator",
      canPostMessages: true,
    });

    const discovery = await findRecentAdminDiscoveryForUser(TEST_USER_ID + 1, 60_000);
    expect(discovery).toBeUndefined();
  });

  it("upserts — a later event for the same chat replaces the earlier state (e.g. demotion)", async () => {
    await recordBotChannelAdminEvent({
      telegramChatId: TEST_CHAT_ID,
      telegramUserId: String(TEST_USER_ID),
      chatTitle: "My Private Channel",
      chatUsername: null,
      isChannel: true,
      botStatus: "administrator",
      canPostMessages: true,
    });
    await recordBotChannelAdminEvent({
      telegramChatId: TEST_CHAT_ID,
      telegramUserId: String(TEST_USER_ID),
      chatTitle: "My Private Channel",
      chatUsername: null,
      isChannel: true,
      botStatus: "left",
      canPostMessages: null,
    });

    const discovery = await findRecentAdminDiscoveryForUser(TEST_USER_ID, 60_000);
    expect(discovery).toBeUndefined();

    const rows = await db.select().from(botChannelAdminEvents).where(eq(botChannelAdminEvents.telegramChatId, TEST_CHAT_ID));
    expect(rows.length).toBe(1);
    expect(rows[0].botStatus).toBe("left");
  });
});
