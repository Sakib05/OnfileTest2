import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { adCampaigns, adConversions } from "@/db/schema";
import { completionReason, eventCost, toNumber } from "./metrics";
import type { MembershipResult } from "./telegram";

/**
 * Verified channel joins. A "join" is counted ONLY when ALL of these hold:
 *   1. a server-side baseline check (getChatMember) showed the user was NOT a member when they started,
 *   2. a later server-side getChatMember confirms they ARE a member now,
 *   3. nothing was counted for this (campaign, user) before — enforced by a UNIQUE index, not by application code.
 * Existing members are recorded as `already_member` and can never convert (leaving and re-joining doesn't help: the
 * first baseline is kept). A click is never a join; the client can't claim one. If Telegram can't answer, nothing is
 * recorded ("unavailable") — we never assume.
 */
export type JoinState = "awaiting_join" | "already_member" | "verified";
export type JoinOutcome =
  | { ok: true; state: JoinState; newlyVerified?: boolean }
  | { ok: false; code: "unavailable" | "start_required" | "campaign_ended" };

type Membership = (chatId: string, telegramUserId: number) => Promise<MembershipResult>;

export interface JoinCampaign {
  id: number;
  tgChatId: string | null;
}

async function existing(campaignId: number, userId: number) {
  const [row] = await db
    .select()
    .from(adConversions)
    .where(and(eq(adConversions.campaignId, campaignId), eq(adConversions.userId, userId)))
    .limit(1);
  return row ?? null;
}

export async function startJoin(c: JoinCampaign, userId: number, telegramUserId: number, getMembership: Membership): Promise<JoinOutcome> {
  if (!c.tgChatId) return { ok: false, code: "unavailable" };
  const prior = await existing(c.id, userId);
  if (prior) return { ok: true, state: prior.status as JoinState }; // the FIRST baseline always stands

  const m = await getMembership(c.tgChatId, telegramUserId);
  if (m === "unavailable") return { ok: false, code: "unavailable" };
  await db
    .insert(adConversions)
    .values({ campaignId: c.id, userId, status: m === "member" ? "already_member" : "awaiting_join" })
    .onConflictDoNothing({ target: [adConversions.campaignId, adConversions.userId] });
  const row = await existing(c.id, userId);
  return { ok: true, state: (row?.status ?? "awaiting_join") as JoinState };
}

export async function verifyJoin(c: JoinCampaign, userId: number, telegramUserId: number, getMembership: Membership, now: Date = new Date()): Promise<JoinOutcome> {
  const prior = await existing(c.id, userId);
  if (!prior) return { ok: false, code: "start_required" };
  if (prior.status === "verified") return { ok: true, state: "verified" }; // idempotent
  if (prior.status === "already_member") return { ok: true, state: "already_member" };
  if (!c.tgChatId) return { ok: false, code: "unavailable" };

  const m = await getMembership(c.tgChatId, telegramUserId);
  if (m === "unavailable") return { ok: false, code: "unavailable" };
  if (m === "not_member") return { ok: true, state: "awaiting_join" };

  return db.transaction(async (tx) => {
    const [camp] = await tx.select().from(adCampaigns).where(eq(adCampaigns.id, c.id)).for("update").limit(1);
    if (!camp || camp.status !== "active" || camp.paymentStatus !== "confirmed") return { ok: false, code: "campaign_ended" } as const;

    const cost = eventCost(camp.pricingModel, camp.unitPrice, "join");
    if (cost > 0 && toNumber(camp.spent) + cost > toNumber(camp.budget) + 1e-9) {
      await tx
        .update(adCampaigns)
        .set({ status: "completed", completedAt: now, completionReason: "budget_exhausted", updatedAt: now })
        .where(eq(adCampaigns.id, camp.id));
      return { ok: false, code: "campaign_ended" } as const;
    }

    // Conditional transition: only ONE request can move awaiting_join → verified.
    const flipped = await tx
      .update(adConversions)
      .set({ status: "verified", verifiedAt: now, cost: cost.toFixed(6) })
      .where(and(eq(adConversions.campaignId, c.id), eq(adConversions.userId, userId), eq(adConversions.status, "awaiting_join")))
      .returning({ id: adConversions.id });
    if (flipped.length === 0) return { ok: true, state: "verified", newlyVerified: false } as const;

    const verifiedJoins = (camp.verifiedJoins ?? 0) + 1;
    const spent = Math.round((toNumber(camp.spent) + cost) * 1e6) / 1e6;
    const reason = completionReason({ objective: camp.objective, budget: camp.budget, spent, targetAmount: camp.targetAmount, endDate: camp.endDate, impressions: camp.impressions ?? 0, clicks: camp.clicks ?? 0, verifiedJoins }, now);
    await tx
      .update(adCampaigns)
      .set({
        verifiedJoins,
        spent: spent.toFixed(6),
        updatedAt: now,
        ...(reason ? { status: "completed" as const, completedAt: now, completionReason: reason } : {}),
      })
      .where(eq(adCampaigns.id, camp.id));
    return { ok: true, state: "verified", newlyVerified: true } as const;
  });
}
