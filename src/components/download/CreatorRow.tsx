"use client";
import React from "react";
import TelegramAvatar from "@/components/ui/TelegramAvatar";
import { cn } from "@/lib/utils";
import type { DownloadCreatorInfo } from "@/lib/download";

/** Creator identity (public name, @username and Telegram photo only). Renders nothing when unknown. */
export default function CreatorRow({ creator, className }: { creator: DownloadCreatorInfo | null; className?: string }) {
  if (!creator || (!creator.firstName && !creator.username)) return null;
  return (
    <div className={cn("flex items-center gap-3 min-w-0 w-full", className)}>
      <TelegramAvatar photoUrl={creator.avatarUrl} firstName={creator.firstName} username={creator.username} size="sm" />
      <div className="min-w-0 flex-1 text-left">
        <p className="text-[11px] text-muted leading-tight">Shared by</p>
        <p className="text-sm font-semibold text-primary leading-tight truncate">{creator.firstName || `@${creator.username}`}</p>
        {creator.firstName && creator.username && <p className="text-xs text-secondary leading-tight truncate">@{creator.username}</p>}
      </div>
    </div>
  );
}
