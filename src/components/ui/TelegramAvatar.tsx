"use client";
import React, { useState } from "react";
import { cn } from "@/lib/utils";
import { getAvatarInitial, sanitizeAvatarUrl } from "@/lib/avatar";

type AvatarSize = "sm" | "md" | "lg" | number;

const SIZE_PX: Record<"sm" | "md" | "lg", number> = { sm: 32, md: 48, lg: 64 };

interface TelegramAvatarProps {
  /** Telegram `photo_url` (as stored from verified initData). May be missing. */
  photoUrl?: string | null;
  firstName?: string | null;
  username?: string | null;
  /** Preset ("sm" 32px, "md" 48px, "lg" 64px) or an explicit pixel size. */
  size?: AvatarSize;
  className?: string;
}

/**
 * Circular Telegram profile picture with a designed initial-letter fallback.
 *
 * - The fallback circle is ALWAYS rendered underneath, with a fixed size, so
 *   there is no layout shift and no broken-image icon while loading or if the
 *   image fails.
 * - The photo is overlaid (object-fit: cover) and only revealed once it has
 *   actually loaded; `onError` permanently switches back to the fallback for
 *   that URL.
 * - Colors come from the app's theme variables so it works in light and dark.
 */
export default function TelegramAvatar({ photoUrl, firstName, username, size = "md", className }: TelegramAvatarProps) {
  const px = typeof size === "number" ? size : SIZE_PX[size];
  const safeUrl = sanitizeAvatarUrl(photoUrl);
  const initial = getAvatarInitial(firstName, username);

  // Track state per URL so a changed `photoUrl` gets a fresh attempt without
  // needing an effect to reset state.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);

  const showImage = !!safeUrl && failedUrl !== safeUrl;
  const imageReady = showImage && loadedUrl === safeUrl;

  return (
    <div
      className={cn(
        "relative inline-flex flex-shrink-0 items-center justify-center overflow-hidden rounded-full border border-app bg-brand-20 text-brand select-none",
        className
      )}
      style={{ width: px, height: px, minWidth: px, minHeight: px }}
      role="img"
      aria-label={firstName || username || "Telegram profile picture"}
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
          onError={() => setFailedUrl(safeUrl)}
          className={cn(
            "absolute inset-0 h-full w-full rounded-full object-cover transition-opacity duration-200",
            imageReady ? "opacity-100" : "opacity-0"
          )}
        />
      )}
    </div>
  );
}
