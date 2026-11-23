"use client";
import React from "react";
import TelegramAvatar from "@/components/ui/TelegramAvatar";
import { cn } from "@/lib/utils";
import type { DownloadCreatorInfo } from "@/lib/download";

/**
 * Uploader identity for the public viewer: profile photo and display name ONLY.
 * The @username is deliberately never rendered (and never passed to the avatar), so it can't leak through
 * the initial-letter fallback either. Renders nothing when the uploader is unknown.
 */
export default function CreatorRow({ creator, className }: { creator: DownloadCreatorInfo | null; className?: string }) {
  if (!creator) return null;
  const name = creator.firstName?.trim() || "Creator";
  return (
    <div className={cn("flex items-center gap-2.5 min-w-0 w-full", className)} data-testid="uploader">
      <TelegramAvatar customUrl={creator.customAvatarUrl} photoUrl={creator.avatarUrl} firstName={creator.firstName} size="sm" />
      <p className="min-w-0 flex-1 text-sm font-semibold text-primary leading-tight truncate">{name}</p>
    </div>
  );
}
