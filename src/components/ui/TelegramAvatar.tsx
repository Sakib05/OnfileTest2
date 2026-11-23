"use client";
import React, { useState } from "react";
import { cn } from "@/lib/utils";
import { avatarCandidates, getAvatarInitial } from "@/lib/avatar";

type AvatarSize = "sm" | "md" | "lg" | number;

const SIZE_PX: Record<"sm" | "md" | "lg", number> = { sm: 32, md: 48, lg: 64 };

interface TelegramAvatarProps {
  /** Telegram `photo_url` (as stored from verified initData). May be missing. */
  photoUrl?: string | null;
  /**
   * URL of the user's CUSTOM uploaded picture (Priority 1). IGNORED while the custom-picture feature is disabled
   * (CUSTOM_PROFILE_PICTURE_ENABLED = false). When enabled it is tried before `photoUrl`; if it fails to load we
   * fall back to the Telegram photo, then to the initial-letter avatar.
   */
  customUrl?: string | null;
  firstName?: string | null;
  username?: string | null;
  /** Preset ("sm" 32px, "md" 48px, "lg" 64px) or an explicit pixel size. */
  size?: AvatarSize;
  className?: string;
}

/**
 * Circular profile picture. Priority: Telegram photo → initial-letter fallback.
 * (Custom uploaded picture → first, but only while CUSTOM_PROFILE_PICTURE_ENABLED is true — currently disabled.)
 *
 * - The fallback circle is ALWAYS rendered underneath, with a fixed size, so
 *   there is no layout shift and no broken-image icon while loading or if the
 *   image fails.
 * - The photo is overlaid (object-fit: cover) and only revealed once it has
 *   actually loaded; `onError` permanently switches back to the fallback for
 *   that URL.
 * - Colors come from the app's theme variables so it works in light and dark.
 */
export default function TelegramAvatar({ photoUrl, customUrl, firstName, username, size = "md", className }: TelegramAvatarProps) {
  const px = typeof size === "number" ? size : SIZE_PX[size];
  const initial = getAvatarInitial(firstName, username);

  // Image candidates in priority order. A candidate that errors is remembered and skipped, so a broken custom
  // picture transparently falls back to the Telegram photo, and a broken Telegram photo to the initials.
  // While the custom-picture feature is disabled (src/lib/profile/featureFlags.ts) `customUrl` is ignored, so the
  // candidates are just the Telegram photo; a missing / failing photo falls back to the initials circle.
  const candidates = avatarCandidates(customUrl, photoUrl);

  // Track state per URL so a changed URL gets a fresh attempt without needing an effect to reset state.
  const [failedUrls, setFailedUrls] = useState<readonly string[]>([]);
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);

  const safeUrl = candidates.find((u) => !failedUrls.includes(u)) ?? null;
  const showImage = !!safeUrl;
  const imageReady = showImage && loadedUrl === safeUrl;

  return (
    <div
      className={cn(
        "relative inline-flex flex-shrink-0 items-center justify-center overflow-hidden rounded-full border border-app bg-brand-20 text-brand select-none",
        className
      )}
      style={{ width: px, height: px, minWidth: px, minHeight: px }}
      role="img"
      aria-label={firstName || username || "Profile picture"}
    >
      <span aria-hidden="true" className="font-bold leading-none" style={{ fontSize: Math.round(px * 0.42) }}>
        {initial}
      </span>
      {showImage && (
        // eslint-disable-next-line @next/next/no-img-element -- external Telegram CDN avatar; next/image optimization is not needed for a 32-64px circle
        <img
          key={safeUrl}
          src={safeUrl}
          alt=""
          width={px}
          height={px}
          referrerPolicy="no-referrer"
          decoding="async"
          draggable={false}
          onLoad={() => setLoadedUrl(safeUrl)}
          onError={() => setFailedUrls((prev) => (prev.includes(safeUrl) ? prev : [...prev, safeUrl]))}
          className={cn(
            "absolute inset-0 h-full w-full rounded-full object-cover transition-opacity duration-200",
            imageReady ? "opacity-100" : "opacity-0"
          )}
        />
      )}
    </div>
  );
}
