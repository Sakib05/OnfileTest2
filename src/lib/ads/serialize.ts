import type { adCampaigns } from "@/db/schema";
import {
  PAYMENT_STATUS_LABELS,
  STATUS_LABELS,
  type AdType,
  type CampaignStatus,
  type ContentKind,
  type Objective,
  type PaymentStatus,
  type PricingModel,
} from "./constants";
import { ctr, remainingBudget, targetProgress, toNumber } from "./metrics";
import { creatorCapabilities, type PausedBy } from "./transitions";

export type CampaignRow = typeof adCampaigns.$inferSelect;

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);
const day = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : "");

/**
 * What a creator (or the admin UI) sees. The numeric database id, the creator's user id and the reviewer id are
 * never included; campaigns are addressed by their public reference only.
 */
export function serializeCampaign(row: CampaignRow, extra: { thumbnailUrl?: string | null } = {}) {
  const status = (row.status ?? "draft") as CampaignStatus;
  const counters = { impressions: row.impressions ?? 0, clicks: row.clicks ?? 0, verifiedJoins: row.verifiedJoins ?? 0 };
  const objective = (row.objective ?? null) as Objective | null;
  const budget = row.budget === null ? null : toNumber(row.budget);
  const paymentStatus = (row.paymentStatus ?? "pending_confirmation") as PaymentStatus;
  return {
    ref: row.publicId ?? "",
    status,
    statusLabel: STATUS_LABELS[status] ?? status,
    adType: (row.adType ?? "onfile_content") as AdType,
    contentKind: (row.contentKind ?? null) as ContentKind | null,
    objective,
    title: row.campaignName ?? "",
    headline: row.headline ?? "",
    description: row.description ?? "",
    ctaText: row.ctaText ?? "",
    destinationUrl: row.targetUrl ?? null,
    destinationLabel: row.tgChatTitle ?? null,
    channelUsername: row.tgChatUsername ?? null,
    joinVerifiable: !!row.joinVerifiable,
    placements: (row.placements ?? []) as string[],
    targeting: { countries: row.targeting?.countries ?? [], languages: row.targeting?.languages ?? [] },
    currency: row.currency ?? "USD",
    budget,
    spent: toNumber(row.spent),
    remaining: budget === null ? null : remainingBudget(row.budget, row.spent),
    targetAmount: row.targetAmount ?? null,
    ...counters,
    ctr: ctr(counters.clicks, counters.impressions),
    progress: targetProgress(objective, counters, row.targetAmount),
    startDate: iso(row.startDate),
    endDate: iso(row.endDate),
    createdAt: iso(row.createdAt),
    submittedAt: iso(row.submittedAt),
    reviewedAt: iso(row.reviewedAt),
    rejectionReason: status === "rejected" ? row.rejectionReason ?? null : null,
    completionReason: row.completionReason ?? null,
    pausedBy: (row.pausedBy ?? null) as PausedBy,
    payment: {
      status: paymentStatus,
      label: PAYMENT_STATUS_LABELS[paymentStatus] ?? paymentStatus,
    },
    pricing: row.pricingModel && row.unitPrice ? { model: row.pricingModel as PricingModel, unitPrice: toNumber(row.unitPrice) } : null,
    thumbnailUrl: extra.thumbnailUrl ?? null,
    capabilities: creatorCapabilities(status, row.pausedBy as PausedBy),
    /** Values the wizard needs to re-open a draft. Only ever returned to the owner. */
    config: {
      contentKind: row.contentKind ?? null,
      fileId: row.fileId ?? null,
      playlistId: row.playlistId ?? null,
      channelId: row.channelId ?? null,
      destinationRef: row.destinationRef ?? "",
      inviteLink: row.inviteLink ?? "",
      startDate: day(row.startDate),
      endDate: day(row.endDate),
    },
  };
}

export type PublicCampaign = ReturnType<typeof serializeCampaign>;

export interface Overview {
  totalCampaigns: number;
  activeCampaigns: number;
  impressions: number;
  clicks: number;
  /** null when the creator has no verified-join campaign (the metric doesn't apply). */
  verifiedJoins: number | null;
  spent: number;
  currency: string;
  counts: Record<CampaignStatus | "all", number>;
}

export function buildOverview(rows: Pick<CampaignRow, "status" | "impressions" | "clicks" | "verifiedJoins" | "spent" | "objective">[]): Overview {
  const counts: Overview["counts"] = { all: rows.length, draft: 0, pending: 0, active: 0, paused: 0, completed: 0, rejected: 0 };
  let impressions = 0;
  let clicks = 0;
  let joins = 0;
  let spent = 0;
  let hasJoinCampaign = false;
  for (const r of rows) {
    const s = (r.status ?? "draft") as CampaignStatus;
    if (s in counts) counts[s] += 1;
    impressions += r.impressions ?? 0;
    clicks += r.clicks ?? 0;
    joins += r.verifiedJoins ?? 0;
    spent += toNumber(r.spent);
    if (r.objective === "verified_joins") hasJoinCampaign = true;
  }
  return {
    totalCampaigns: rows.length,
    activeCampaigns: counts.active,
    impressions,
    clicks,
    verifiedJoins: hasJoinCampaign ? joins : null,
    spent: Math.round(spent * 1e6) / 1e6,
    currency: "USD",
    counts,
  };
}
