"use client";
import React, { useState } from "react";

/** Default playlist image: stacked cards with a play mark, in the Onfile brand gradient. */
export function PlaylistArt({ className = "" }: { className?: string }) {
  return (
    <span
      className={`pl-tile absolute inset-0 flex items-center justify-center overflow-hidden ${className}`}
      data-testid="playlist-default-art"
      aria-hidden="true"
    >
      <svg viewBox="0 0 48 48" className="relative h-[66%] max-h-[72px] w-auto" focusable="false" style={{ filter: "drop-shadow(0 1.5px 1.5px rgba(0,0,0,0.22))" }}>
        <rect x="11" y="6" width="26" height="4.5" rx="2.25" fill="#fff" opacity="0.45" />
        <rect x="7.5" y="12.5" width="33" height="4.5" rx="2.25" fill="#fff" opacity="0.7" />
        <rect x="4" y="19" width="40" height="23" rx="6.5" fill="#fff" />
        <path d="M21 25.2l8.5 5.3-8.5 5.3z" fill="var(--color-primary-dark)" stroke="var(--color-primary-dark)" strokeWidth="2.4" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

/**
 * Playlist cover. Fills its (relatively positioned, fixed-size) parent. `url` is
 * the thumbnail of the playlist's FIRST file, derived server-side — there is no
 * separate playlist image to upload. No url (empty playlist, or the first file
 * has no thumbnail) or a load error → the default playlist image.
 */
export default function PlaylistThumb({ url, alt = "" }: { url?: string | null; alt?: string }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (!url || failedUrl === url) return <PlaylistArt />;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- CDN thumbnail, already optimized server-side
    <img
      src={url}
      alt={alt}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      draggable={false}
      onError={() => setFailedUrl(url)}
      className="absolute inset-0 w-full h-full object-cover"
    />
  );
}
