import { and, eq, gt, gte, isNotNull, lte, ne, or, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { adCampaigns, files } from "@/db/schema";
import { isSafeDestination } from "./validation";
import type { MembershipResult } from "./telegram";
import type { CampaignRow } from "./serialize";

/**
 * Force Join — a membership gate on ONE specific file.
 *
 *   • The gate belongs to a campaign whose `placements` contains "force_join"; the gated file is that campaign's
 *     `file_id` (always the campaign owner's own, published file — enforced on save, on submit and on approval).
 *   • It only exists while the campaign is ACTIVE + payment-confirmed + in date + in budget + verifiable. Pending,
 *     paused, rejected, completed or unapproved campaigns gate nothing, so nothing is ever blocked by an unreviewed ad.
 *   • No other file, playlist or Onfile screen is affected: `findActiveGate(fileId)` is keyed by that file only.
 *   • Access is decided on the SERVER from a live `getChatMember` answer. A click on "Join" never opens the gate.
 *     If Telegram can't answer, the gate stays CLOSED ("unavailable") — we never guess.
 *   • The file owner and the campaign owner are never gated.
 */
export type GateState = "login_required" | "join_required" | "unavailable" | "passed";

export interface GateInfo {
  channelTitle: string | null;
  channelUsername: string | null;
  /** Validated https://t.me link people use to join (campaign invite link if one was configured, else the channel link). */
  joinUrl: string | null;
}

export type GateEvaluation = { gated: false } | { gated: true; state: GateState; info: GateInfo };

export function gateInfoOf(c: Pick<CampaignRow, "tgChatTitle" | "tgChatUsername" | "inviteLink" | "targetUrl">): GateInfo {
  const joinUrl = isSafeDestination(c.inviteLink) ? c.inviteLink : isSafeDestination(c.targetUrl) ? c.targetUrl : null;
  return { channelTitle: c.tgChatTitle ?? null, channelUsername: c.tgChatUsername ?? null, joinUrl };
}

/** The live force-join campaign gating `fileId`, if any (oldest first, so overlapping gates resolve deterministically). */
export async function findActiveGate(fileId: number, now: Date = new Date()): Promise<CampaignRow | null> {
  const [row] = await db
    .select()
    .from(adCampaigns)
    .where(
      and(
        eq(adCampaigns.fileId, fileId),
        eq(adCampaigns.status, "active"),
        eq(adCampaigns.paymentStatus, "confirmed"),
        eq(adCampaigns.source, "creator"),
        eq(adCampaigns.objective, "verified_joins"),
        eq(adCampaigns.joinVerifiable, true),
        isNotNull(adCampaigns.tgChatId),
        isNotNull(adCampaigns.userId),
        sql`${adCampaigns.placements} ? 'force_join'`,
        or(isNull(adCampaigns.startDate), lte(adCampaigns.startDate, now)),
        or(isNull(adCampaigns.endDate), gte(adCampaigns.endDate, now)),
        gt(sql`COALESCE(${adCampaigns.budget}, 0) - COALESCE(${adCampaigns.spent}, 0)`, sql`0`)
      )
    )
    .orderBy(adCampaigns.id)
    .limit(1);
  return row ?? null;
}

type Membership = (chatId: string, telegramUserId: number) => Promise<MembershipResult>;

export interface GateViewer {
  id: number;
  telegramId: string | null;
}

/** Decides whether `viewer` may get `file` right now. Pure given its dependencies (unit-testable). */
export async function evaluateGate(
  file: { id: number; userId: number },
  gate: CampaignRow | null,
  viewer: GateViewer | null,
  getMembership: Membership
): Promise<GateEvaluation> {
  if (!gate || !gate.tgChatId) return { gated: false };
  if (viewer && (viewer.id === file.userId || viewer.id === gate.userId)) return { gated: false };
  const info = gateInfoOf(gate);
  if (!viewer) return { gated: true, state: "login_required", info };
  const tgUserId = Number(viewer.telegramId);
  if (!Number.isSafeInteger(tgUserId) || tgUserId <= 0) return { gated: true, state: "login_required", info };
  const m = await getMembership(gate.tgChatId, tgUserId);
  if (m === "member") return { gated: true, state: "passed", info };
  if (m === "not_member") return { gated: true, state: "join_required", info };
  return { gated: true, state: "unavailable", info };
}

/** Admin-approval guard: the gated file is still the owner's published file, and no other live gate covers it. */
export async function checkGateApprovable(row: CampaignRow): Promise<string | null> {
  if (!row.fileId || !row.userId) return "This force-join campaign has no gated file.";
  const [f] = await db
    .select({ id: files.id, isPublished: files.isPublished, slug: files.smartLinkSlug })
    .from(files)
    .where(and(eq(files.id, row.fileId), eq(files.userId, row.userId)))
    .limit(1);
  if (!f || !f.isPublished || !f.slug) return "The gated file is no longer one of the creator's published files.";
  if (row.objective !== "verified_joins" || !row.joinVerifiable) return "Force join requires verified joins on this channel.";
  const [other] = await db
    .select({ id: adCampaigns.id })
    .from(adCampaigns)
    .where(
      and(
        eq(adCampaigns.fileId, row.fileId),
        eq(adCampaigns.status, "active"),
        ne(adCampaigns.id, row.id),
        sql`${adCampaigns.placements} ? 'force_join'`
      )
    )
    .limit(1);
  return other ? "Another active force-join campaign already gates this file." : null;
}
