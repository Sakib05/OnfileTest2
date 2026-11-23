import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { adCampaigns } from "@/db/schema";
import { OBJECTIVE_INFO, type Objective } from "./constants";
import { cleanText, containsMarkup } from "./validation";
import { adminTransition, type AdminAction } from "./transitions";
import { remainingBudget } from "./metrics";
import type { DestinationDeps } from "./destination";
import type { CampaignRow } from "./serialize";

/**
 * Administrator decisions. Callers MUST have passed `requireAdmin` (server-side session + ADMIN_TELEGRAM_IDS) — this
 * module never looks at anything the client says about who is an admin. Every change is a conditional UPDATE on the
 * expected current status, so approving/rejecting twice or racing a creator action can't corrupt state.
 */
export type AdminResult = { ok: true; campaign: CampaignRow } | { ok: false; status: number; error: string };
const err = (status: number, error: string): AdminResult => ({ ok: false, status, error });

export interface AdminActionInput {
  action: AdminAction;
  reason?: unknown;
  unitPrice?: unknown;
  paymentConfirmed?: unknown;
}

export function parseUnitPrice(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  const text = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.trim() : "";
  if (!/^\d{1,4}(\.\d{1,6})?$/.test(text)) return { ok: false, error: "Enter a unit price with at most 6 decimals." };
  const n = Number(text);
  if (!(n > 0) || n > 1000) return { ok: false, error: "The unit price must be greater than 0 and at most 1000." };
  return { ok: true, value: n.toFixed(6) };
}

export function parseReason(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  const text = cleanText(raw);
  if (text.length < 3) return { ok: false, error: "A rejection reason is required (at least 3 characters)." };
  if (text.length > 500) return { ok: false, error: "The reason must be at most 500 characters." };
  if (containsMarkup(text)) return { ok: false, error: "The reason can't contain HTML." };
  return { ok: true, value: text };
}

export async function adminAct(adminUserId: number, ref: string, input: AdminActionInput, deps: Pick<DestinationDeps, "botCanVerifyMembership">, now: Date = new Date()): Promise<AdminResult> {
  const [row] = await db.select().from(adCampaigns).where(eq(adCampaigns.publicId, ref)).limit(1);
  if (!row || !row.userId) return err(404, "Campaign not found."); // legacy rows (no owner) aren't managed here
  const from = row.status ?? "draft";
  const t = adminTransition(input.action, from);
  if (!t.ok || !t.to) return err(409, t.error ?? "That action isn't available.");
  const cond = and(eq(adCampaigns.id, row.id), eq(adCampaigns.status, from));
  const base = { updatedAt: now };

  let patch: Partial<typeof adCampaigns.$inferInsert>;
  switch (input.action) {
    case "approve": {
      const price = parseUnitPrice(input.unitPrice);
      if (!price.ok) return err(400, price.error);
      if (input.paymentConfirmed !== true) return err(400, "Confirm the payment arrangement before approving.");
      if (!row.objective || !(row.objective in OBJECTIVE_INFO)) return err(409, "This campaign has no objective.");
      if (row.endDate && row.endDate.getTime() < now.getTime()) return err(409, "This campaign's end date has already passed.");
      if (row.objective === "verified_joins") {
        // Re-check live: the bot must STILL be able to read membership, or "verified joins" would be a false promise.
        const can = row.tgChatId ? await deps.botCanVerifyMembership(row.tgChatId) : "no";
        if (can !== "yes") return err(409, "Onfile's bot can't verify membership in this channel right now, so a verified-joins campaign can't be approved.");
      }
      patch = {
        ...base,
        status: "active",
        pricingModel: OBJECTIVE_INFO[row.objective as Objective].pricingModel,
        unitPrice: price.value,
        paymentStatus: "confirmed",
        reviewedBy: adminUserId,
        reviewedAt: now,
        rejectionReason: null,
        pausedBy: null,
      };
      break;
    }
    case "reject": {
      const reason = parseReason(input.reason);
      if (!reason.ok) return err(400, reason.error);
      patch = { ...base, status: "rejected", rejectionReason: reason.value, reviewedBy: adminUserId, reviewedAt: now };
      break;
    }
    case "pause":
      patch = { ...base, status: "paused", pausedBy: "admin" };
      break;
    case "resume":
      if (row.endDate && row.endDate.getTime() < now.getTime()) return err(409, "This campaign's end date has passed.");
      if (row.budget !== null && remainingBudget(row.budget, row.spent) <= 0) return err(409, "This campaign's budget is used up.");
      patch = { ...base, status: "active", pausedBy: null };
      break;
    case "complete":
      patch = { ...base, status: "completed", completedAt: now, completionReason: "admin" };
      break;
  }
  const updated = await db.update(adCampaigns).set(patch).where(cond).returning();
  return updated[0] ? { ok: true, campaign: updated[0] } : err(409, "The campaign changed in the meantime. Refresh and try again.");
}
