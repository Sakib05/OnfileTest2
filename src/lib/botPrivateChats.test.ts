import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { botPrivateChats } from "@/db/schema";
import { getPrivateChat, markPrivateChatBlocked, recordPrivateChat, removePrivateChat } from "@/lib/botPrivateChats";

const U1 = "900_500_001".replace(/_/g, "");
const U2 = "900_500_002".replace(/_/g, "");

async function cleanup() {
  await db.delete(botPrivateChats).where(inArray(botPrivateChats.telegramUserId, [U1, U2]));
}
beforeEach(cleanup);
afterAll(cleanup);

describe("bot_private_chats store", () => {
  it("returns null when nothing is known", async () => {
    expect(await getPrivateChat(U1)).toBeNull();
  });

  it("stores user id and chat id side by side (never assumes they are equal)", async () => {
    await recordPrivateChat(U1, "700500001");
    expect(await getPrivateChat(U1)).toEqual({ telegramUserId: U1, chatId: "700500001", status: "active", source: "webhook" });
    expect(await getPrivateChat(U2)).toBeNull();
  });

  it("accepts numbers and strings and upserts (one row per user)", async () => {
    await recordPrivateChat(Number(U1), 700500001);
    await recordPrivateChat(U1, "700500009", "get_chat");
    const rows = await db.select().from(botPrivateChats).where(inArray(botPrivateChats.telegramUserId, [U1]));
    expect(rows).toHaveLength(1);
    expect(rows[0].chatId).toBe("700500009");
    expect(rows[0].source).toBe("get_chat");
  });

  it("blocked → active again when the user is seen again", async () => {
    await recordPrivateChat(U1, "700500001");
    await markPrivateChatBlocked(U1, "700500001");
    expect((await getPrivateChat(U1))?.status).toBe("blocked");
    await recordPrivateChat(U1, "700500001");
    expect((await getPrivateChat(U1))?.status).toBe("active");
  });

  it("a stale blocked/removed signal for a DIFFERENT chat id does not touch the current association", async () => {
    await recordPrivateChat(U1, "700500001");
    await markPrivateChatBlocked(U1, "999");
    await removePrivateChat(U1, "999");
    expect(await getPrivateChat(U1)).toMatchObject({ chatId: "700500001", status: "active" });
    await removePrivateChat(U1, "700500001");
    expect(await getPrivateChat(U1)).toBeNull();
  });
});
