"use client";
import React, { useState } from "react";
import FileTypeArt from "./FileTypeArt";

/**
 * Fills its (fixed-size, relatively positioned) parent. Shows the creator's
 * thumbnail when available, otherwise — or if the image fails to load — the
 * branded file-type artwork (FileTypeArt). The parent reserves the space, so there is no layout
 * shift. Thumbnail URLs are versioned/immutable, so the browser can cache them.
 */
export default function FileThumb({
  url,
  fileType,
  title,
  mimeType,
  alt = "",
  eager = false,
}: {
  url?: string | null;
  fileType: string | null | undefined;
  /** Optional: lets the artwork tell PDF / Word / Excel / APK … apart by file extension. */
  title?: string | null;
  mimeType?: string | null;
  alt?: string;
  eager?: boolean;
}) {
  // Reset the failure flag when the URL changes (e.g. after a replacement).
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (!url || failedUrl === url) {
    return <FileTypeArt fileType={fileType} title={title} mimeType={mimeType} />;
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
