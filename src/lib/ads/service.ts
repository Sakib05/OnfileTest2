import { and, count, eq } from "drizzle-orm";
import { db } from "@/db";
import { adCampaigns } from "@/db/schema";
import { DEFAULT_CTA, OBJECTIVES_BY_TYPE, type AdType } from "./constants";
import { resolveDestination, type DestinationDeps } from "./destination";
import { creatorTransition, type CreatorAction } from "./transitions";
import { generatePublicId } from "./tokens";
import { remainingBudget } from "./metrics";
import { validateCampaignInput, type CampaignInput, type FieldErrors } from "./validation";
import type { CampaignRow } from "./serialize";

/**
 * Creator-side campaign operations (create / update draft / submit / pause / resume / reopen / delete).
 * `userId` always comes from the authenticated session. Status, spend, counters, pricing and payment can never be set
 * here: `validateCampaignInput` doesn't produce those fields and every status change goes through `creatorTransition`
 * plus a conditional UPDATE (`WHERE status = <expected>`), so races and double taps are harmless.
 */
export type ServiceResult<T = CampaignRow> =
  | { ok: true; campaign: T; created?: boolean; alreadyDone?: boolean }
  | { ok: false; status: number; error: string; fieldErrors?: FieldErrors };

export const MAX_CAMPAIGNS_PER_USER = 100;

const err = (status: number, error: string, fieldErrors?: FieldErrors): { ok: false; status: number; error: string; fieldErrors?: FieldErrors } => ({ ok: false, status, error, fieldErrors });

function columnsFromInput(input: CampaignInput) {
  return {
    campaignName: input.title || null,
    adType: input.adType,
    contentKind: input.contentKind,
    objective: input.objective,
    headline: input.headline || null,
    description: input.description || null,
    ctaText: input.ctaText || null,
    fileId: input.fileId,
    playlistId: input.playlistId,
    channelId: input.channelId,
    destinationRef: input.destinationRef,
    inviteLink: input.inviteLink,
    placements: input.placements,
    targeting: input.targeting,
    budget: input.budget,
    targetAmount: input.targetAmount,
    startDate: input.startDate,
    endDate: input.endDate,
  };
}

/** Cheap, database-only ownership check used when saving drafts (no network). */
async function checkOwnedReferences(input: CampaignInput, userId: number, deps: DestinationDeps): Promise<FieldErrors | null> {
  if (input.fileId && !(await deps.getOwnedFile(userId, input.fileId))) return { fileId: "We couldn't find that file in your account." };
  if (input.playlistId && !(await deps.getOwnedPlaylist(userId, input.playlistId))) return { playlistId: "We couldn't find that playlist in your account." };
  if (input.channelId && !(await deps.getOwnedChannel(userId, input.channelId))) return { channelId: "We couldn't find that channel in your account." };
  return null;
}

export async function createDraft(
  user: { id: number; firstName?: string | null; username?: string | null },
  body: unknown,
  deps: DestinationDeps
): Promise<ServiceResult> {
  const v = validateCampaignInput(body, "draft");
  if (!v.ok) return err(400, "Please fix the highlighted fields.", v.errors);
  if (!v.value.clientRef) return err(400, "Missing client reference.", { clientRef: "Required." });
  const owned = await checkOwnedReferences(v.value, user.id, deps);
  if (owned) return err(404, Object.values(owned)[0], owned);

  // Idempotent: a retried create (double tap, flaky network) returns the same campaign.
  const [dup] = await db
    .select()
    .from(adCampaigns)
    .where(and(eq(adCampaigns.userId, user.id), eq(adCampaigns.clientRef, v.value.clientRef)))
    .limit(1);
  if (dup) return { ok: true, campaign: dup, created: false };

  const [{ n }] = await db.select({ n: count() }).from(adCampaigns).where(eq(adCampaigns.userId, user.id));
  if (n >= MAX_CAMPAIGNS_PER_USER) return err(409, `You've reached the limit of ${MAX_CAMPAIGNS_PER_USER} campaigns. Delete old drafts first.`);

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const inserted = await db
        .insert(adCampaigns)
        .values({
          ...columnsFromInput(v.value),
          publicId: generatePublicId(),
          userId: user.id,
          source: "creator",
          network: "onfile",
          clientRef: v.value.clientRef,
          advertiserName: user.firstName ?? user.username ?? null,
          status: "draft",
          paymentStatus: "pending_confirmation",
        })
        .onConflictDoNothing({ target: [adCampaigns.userId, adCampaigns.clientRef] })
        .returning();
      if (inserted[0]) return { ok: true, campaign: inserted[0], created: true };
      const [again] = await db.select().from(adCampaigns).where(and(eq(adCampaigns.userId, user.id), eq(adCampaigns.clientRef, v.value.clientRef))).limit(1);
      if (again) return { ok: true, campaign: again, created: false };
    } catch (e) {
      // Unique violation on public_id (astronomically rare): retry with a fresh reference.
      if ((e as { code?: string })?.code !== "23505") throw e;
    }
  }
  return err(500, "Couldn't save the draft. Please try again.");
}

export async function updateDraft(userId: number, ref: string, body: unknown, deps: DestinationDeps): Promise<ServiceResult> {
  const v = validateCampaignInput(body, "draft");
  if (!v.ok) return err(400, "Please fix the highlighted fields.", v.errors);
  const owned = await checkOwnedReferences(v.value, userId, deps);
  if (owned) return err(404, Object.values(owned)[0], owned);

  const updated = await db
    .update(adCampaigns)
    .set({ ...columnsFromInput(v.value), updatedAt: new Date() })
    .where(and(eq(adCampaigns.publicId, ref), eq(adCampaigns.userId, userId), eq(adCampaigns.status, "draft")))
    .returning();
  if (updated[0]) return { ok: true, campaign: updated[0] };

  const [row] = await db.select({ status: adCampaigns.status }).from(adCampaigns).where(and(eq(adCampaigns.publicId, ref), eq(adCampaigns.userId, userId))).limit(1);
  return row ? err(409, "Only drafts can be edited. This campaign has already been submitted.") : err(404, "Campaign not found.");
}

function rowToRaw(row: CampaignRow): Record<string, unknown> {
  const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
  return {
    adType: row.adType,
    contentKind: row.contentKind,
    fileId: row.fileId,
    playlistId: row.playlistId,
    channelId: row.channelId,
    destinationRef: row.destinationRef,
    inviteLink: row.inviteLink,
    objective: row.objective,
    title: row.campaignName,
    headline: row.headline,
    description: row.description,
    ctaText: row.ctaText || (row.adType ? DEFAULT_CTA[row.adType as AdType] : ""),
    placements: row.placements ?? [],
    targeting: row.targeting ?? {},
    budget: row.budget,
    targetAmount: row.targetAmount,
    startDate: day(row.startDate),
    endDate: day(row.endDate),
  };
}

export async function submitCampaign(userId: number, ref: string, deps: DestinationDeps, now: Date = new Date()): Promise<ServiceResult> {
  const [row] = await db.select().from(adCampaigns).where(and(eq(adCampaigns.publicId, ref), eq(adCampaigns.userId, userId))).limit(1);
  if (!row) return err(404, "Campaign not found.");
  const status = row.status ?? "draft";
  if (status === "pending") return { ok: true, campaign: row, alreadyDone: true }; // double tap / retry
  const t = creatorTransition("submit", status);
  if (!t.ok) return err(409, t.error ?? "This campaign can't be submitted.");

  // Full validation of the STORED draft — the server never trusts that the client validated anything.
  const v = validateCampaignInput(rowToRaw(row), "submit", now);
  if (!v.ok) return err(422, "Your campaign isn't complete yet.", v.errors);
  const input = v.value;
  if (input.objective && !OBJECTIVES_BY_TYPE[input.adType].includes(input.objective)) return err(422, "Invalid objective.", { objective: "Invalid objective." });

  const dest = await resolveDestination(input, userId, deps);
  if (!dest.ok) return err(dest.status ?? 422, dest.error, { [dest.field]: dest.error });
  const d = dest.value;
  if (input.objective === "verified_joins" && !d.joinVerifiable) {
    const msg = d.joinNote ?? "Joins can't be verified for this channel.";
    return err(422, msg, { objective: msg });
  }

  const updated = await db
    .update(adCampaigns)
    .set({
      status: "pending",
      submittedAt: now,
      updatedAt: now,
      targetUrl: d.targetUrl,
      fileId: d.fileId,
      playlistId: d.playlistId,
      channelId: d.channelId,
      inviteLink: d.inviteLink,
      tgChatId: d.tgChatId,
      tgChatUsername: d.tgChatUsername,
      tgChatTitle: d.tgChatTitle ?? d.label,
      joinVerifiable: d.joinVerifiable,
      rejectionReason: null,
      paymentStatus: "pending_confirmation",
    })
    .where(and(eq(adCampaigns.id, row.id), eq(adCampaigns.userId, userId), eq(adCampaigns.status, "draft")))
    .returning();
  if (updated[0]) return { ok: true, campaign: updated[0] };
  const [now2] = await db.select().from(adCampaigns).where(eq(adCampaigns.id, row.id)).limit(1);
  return now2 && now2.status === "pending" ? { ok: true, campaign: now2, alreadyDone: true } : err(409, "This campaign can't be submitted.");
}

export async function creatorAction(userId: number, ref: string, action: Exclude<CreatorAction, "submit">, now: Date = new Date()): Promise<ServiceResult<CampaignRow | null>> {
  const [row] = await db.select().from(adCampaigns).where(and(eq(adCampaigns.publicId, ref), eq(adCampaigns.userId, userId))).limit(1);
  if (!row) return err(404, "Campaign not found.");
  const from = row.status ?? "draft";
  const t = creatorTransition(action, from, row.pausedBy as "creator" | "admin" | null);
  if (!t.ok) return err(409, t.error ?? "That action isn't available.");
  const own = and(eq(adCampaigns.id, row.id), eq(adCampaigns.userId, userId), eq(adCampaigns.status, from));

  if (action === "delete") {
    const del = await db.delete(adCampaigns).where(own).returning({ id: adCampaigns.id });
    return del.length ? { ok: true, campaign: null } : err(409, "Only drafts can be deleted.");
  }
  if (action === "resume") {
    if (row.endDate && row.endDate.getTime() < now.getTime()) return err(409, "This campaign's end date has passed.");
    if (row.budget !== null && remainingBudget(row.budget, row.spent) <= 0) return err(409, "This campaign's budget is used up.");
  }
  const patch =
    action === "pause" ? { status: "paused" as const, pausedBy: "creator" }
    : action === "resume" ? { status: "active" as const, pausedBy: null }
    : { status: "draft" as const, rejectionReason: null, reviewedAt: null };
  const updated = await db.update(adCampaigns).set({ ...patch, updatedAt: now }).where(own).returning();
  return updated[0] ? { ok: true, campaign: updated[0] } : err(409, "The campaign changed in the meantime. Refresh and try again.");
}
