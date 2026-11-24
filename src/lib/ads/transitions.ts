import type { CampaignStatus } from "./constants";

/**
 * Campaign lifecycle rules (pure). The server calls `canTransition` before EVERY status change and then performs
 * the change with a conditional UPDATE (`WHERE status = <from>`), so a double tap or a race can't apply it twice.
 *
 *   draft ──submit──▶ pending ──approve──▶ active ◀──resume── paused
 *     ▲                  │                   │  └──pause──▶
 *     └────reopen──── rejected ◀──reject─────┘ (from pending only)
 *   active|paused ──complete──▶ completed   (admin, or automatically: target / budget / end date)
 */
export type CreatorAction = "submit" | "pause" | "resume" | "delete" | "reopen";
export type AdminAction = "approve" | "reject" | "pause" | "resume" | "complete";
export type PausedBy = "creator" | "admin" | null | undefined;

export interface TransitionResult {
  ok: boolean;
  to?: CampaignStatus;
  error?: string;
}

const no = (error: string): TransitionResult => ({ ok: false, error });

export function creatorTransition(action: CreatorAction, from: CampaignStatus, pausedBy?: PausedBy): TransitionResult {
  switch (action) {
    case "submit":
      return from === "draft" ? { ok: true, to: "pending" } : no("Only a draft can be submitted for review.");
    case "pause":
      return from === "active" ? { ok: true, to: "paused" } : no("Only an active campaign can be paused.");
    case "resume":
      if (from !== "paused") return no("Only a paused campaign can be resumed.");
      return pausedBy === "admin" ? no("This campaign was paused by Onfile and can only be resumed by an administrator.") : { ok: true, to: "active" };
    case "reopen":
      return from === "rejected" ? { ok: true, to: "draft" } : no("Only a rejected campaign can be reopened as a draft.");
    case "delete":
      return from === "draft" ? { ok: true } : no("Only drafts can be deleted.");
  }
}

export function adminTransition(action: AdminAction, from: CampaignStatus): TransitionResult {
  switch (action) {
    case "approve":
      return from === "pending" ? { ok: true, to: "active" } : no("Only a campaign pending review can be approved.");
    case "reject":
      return from === "pending" ? { ok: true, to: "rejected" } : no("Only a campaign pending review can be rejected.");
    case "pause":
      return from === "active" ? { ok: true, to: "paused" } : no("Only an active campaign can be paused.");
    case "resume":
      return from === "paused" ? { ok: true, to: "active" } : no("Only a paused campaign can be resumed.");
    case "complete":
      return from === "active" || from === "paused" ? { ok: true, to: "completed" } : no("Only an active or paused campaign can be completed.");
  }
}

/** Actions the creator's UI may show for a campaign — derived from the SAME rules the server enforces. */
export interface CreatorCapabilities {
  viewDetails: true;
  edit: boolean;
  submit: boolean;
  pause: boolean;
  resume: boolean;
  reopen: boolean;
  remove: boolean;
  viewPerformance: boolean;
}

export function creatorCapabilities(status: CampaignStatus, pausedBy?: PausedBy): CreatorCapabilities {
  return {
    viewDetails: true,
    edit: status === "draft",
    submit: status === "draft",
    pause: creatorTransition("pause", status).ok,
    resume: creatorTransition("resume", status, pausedBy).ok,
    reopen: status === "rejected",
    remove: status === "draft",
    viewPerformance: status === "active" || status === "paused" || status === "completed",
  };
}
