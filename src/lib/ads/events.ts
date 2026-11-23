import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { adCampaigns, adEvents } from "@/db/schema";
import type { SlotKey } from "./constants";
import { completionReason, eventCost, toNumber } from "./metrics";

/**
 * The ONLY writer of impressions / clicks / spend. Everything happens in one transaction under a row lock on the
 * campaign, so concurrent requests can't double count or overspend:
 *   1. the campaign must be active, payment-confirmed, inside its dates and not the viewer's own campaign;
 *   2. the event is inserted with a UNIQUE `dedupe_key` (viewer + day [+ placement for impressions]) — a repeat is
 *      rejected by the database and changes nothing;
 *   3. cost accrues only when an admin set a price, and never beyond the budget;
 *   4. completion rules (target / budget / end date) are evaluated right after the counters change.
 */
export type RecordResult = { recorded: true } | { recorded: false; reason: "not_active" | "own_campaign" | "duplicate" | "budget_exhausted" | "not_found" };

export interface RecordArgs {
  campaignId: number;
  type: "impression" | "click";
  placement: SlotKey;
  viewerKey: string;
  userId: number | null;
  country: string | null;
  now?: Date;
}

export function dedupeKeyFor(args: Pick<RecordArgs, "campaignId" | "type" | "placement" | "viewerKey">, now: Date): string {
  const d = now.toISOString().slice(0, 10);
  return args.type === "impression"
    ? `${args.campaignId}:i:${args.viewerKey}:${args.placement}:${d}`
    : `${args.campaignId}:c:${args.viewerKey}:${d}`;
}

export async function recordAdEvent(args: RecordArgs): Promise<RecordResult> {
  const now = args.now ?? new Date();
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(adCampaigns).where(eq(adCampaigns.id, args.campaignId)).for("update").limit(1);
    if (!c) return { recorded: false, reason: "not_found" } as const;
    if (c.userId && args.userId && c.userId === args.userId) return { recorded: false, reason: "own_campaign" } as const;

    const live =
      c.status === "active" &&
      c.paymentStatus === "confirmed" &&
      (!c.startDate || c.startDate.getTime() <= now.getTime()) &&
      (!c.endDate || c.endDate.getTime() >= now.getTime());
    if (!live) return { recorded: false, reason: "not_active" } as const;

    const cost = eventCost(c.pricingModel, c.unitPrice, args.type);
    if (cost > 0 && toNumber(c.spent) + cost > toNumber(c.budget) + 1e-9) {
      await tx
        .update(adCampaigns)
        .set({ status: "completed", completedAt: now, completionReason: "budget_exhausted", updatedAt: now })
        .where(and(eq(adCampaigns.id, c.id), eq(adCampaigns.status, "active")));
      return { recorded: false, reason: "budget_exhausted" } as const;
    }

    const inserted = await tx
      .insert(adEvents)
      .values({
        campaignId: c.id,
        eventType: args.type,
        placement: args.placement,
        viewerKey: args.viewerKey,
        userId: args.userId,
        country: args.country,
        cost: cost.toFixed(6),
        dedupeKey: dedupeKeyFor(args, now),
        createdAt: now,
      })
      .onConflictDoNothing({ target: adEvents.dedupeKey })
      .returning({ id: adEvents.id });
    if (inserted.length === 0) return { recorded: false, reason: "duplicate" } as const;

    const impressions = (c.impressions ?? 0) + (args.type === "impression" ? 1 : 0);
    const clicks = (c.clicks ?? 0) + (args.type === "click" ? 1 : 0);
    const spent = Math.round((toNumber(c.spent) + cost) * 1e6) / 1e6;
    const reason = completionReason({ objective: c.objective, budget: c.budget, spent, targetAmount: c.targetAmount, endDate: c.endDate, impressions, clicks, verifiedJoins: c.verifiedJoins ?? 0 }, now);

    await tx
      .update(adCampaigns)
      .set({
        impressions,
        clicks,
        spent: spent.toFixed(6),
        updatedAt: now,
        ...(reason ? { status: "completed" as const, completedAt: now, completionReason: reason } : {}),
      })
      .where(eq(adCampaigns.id, c.id));
    return { recorded: true } as const;
  });
}

/** Completes campaigns whose end date has passed. Cheap, idempotent; called lazily before reads/serves (no cron needed). */
export async function sweepExpiredCampaigns(now: Date = new Date()): Promise<void> {
  await db.execute(sql`
    UPDATE ad_campaigns
       SET status = 'completed', completed_at = ${now}, completion_reason = 'duration_ended', updated_at = ${now}
     WHERE status IN ('active', 'paused') AND end_date IS NOT NULL AND end_date < ${now}`);
}
