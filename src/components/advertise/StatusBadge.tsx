"use client";
import React from "react";
import { CheckCircle2, Clock, FileEdit, PauseCircle, XCircle, Flag } from "lucide-react";
import { cn } from "@/lib/utils";
import { STATUS_LABELS, type CampaignStatus } from "@/lib/ads/constants";

const STYLE: Record<CampaignStatus, { cls: string; Icon: React.ComponentType<{ size?: number; "aria-hidden"?: boolean }> }> = {
  draft: { cls: "bg-secondary text-secondary", Icon: FileEdit },
  pending: { cls: "status-pending", Icon: Clock },
  active: { cls: "status-completed", Icon: CheckCircle2 },
  paused: { cls: "status-processing", Icon: PauseCircle },
  completed: { cls: "bg-brand-10 text-brand", Icon: Flag },
  rejected: { cls: "status-rejected", Icon: XCircle },
};

export default function StatusBadge({ status, className }: { status: CampaignStatus; className?: string }) {
  const { cls, Icon } = STYLE[status] ?? STYLE.draft;
  return (
    <span className={cn("chip flex-shrink-0 whitespace-nowrap", cls, className)} data-testid="status-badge" data-status={status}>
      <Icon size={12} aria-hidden={true} />
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}
