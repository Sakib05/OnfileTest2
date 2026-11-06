"use client";
import React, { useState } from "react";
import { getFileTypeIcon } from "@/lib/utils";

/**
 * Fills its (fixed-size, relatively positioned) parent. Shows the creator's
 * thumbnail when available, otherwise — or if the image fails to load — the
 * file-type emoji icon. The parent reserves the space, so there is no layout
 * shift. Thumbnail URLs are versioned/immutable, so the browser can cache them.
 */
export default function FileThumb({
  url,
  fileType,
  alt = "",
  eager = false,
}: {
  url?: string | null;
  fileType: string;
  alt?: string;
  eager?: boolean;
}) {
  // Reset the failure flag when the URL changes (e.g. after a replacement).
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (!url || failedUrl === url) {
    return <span aria-hidden="true">{getFileTypeIcon(fileType)}</span>;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- external CDN, already optimized server-side
    <img
      src={url}
      alt={alt}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      referrerPolicy="no-referrer"
      draggable={false}
      onError={() => setFailedUrl(url)}
      className="absolute inset-0 w-full h-full object-cover"
    />
  );
}
