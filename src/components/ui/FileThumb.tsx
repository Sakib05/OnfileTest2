"use client";
import React, { useState } from "react";
import { cn, getFileTypeIcon } from "@/lib/utils";

/**
 * Shows a file's thumbnail when one exists, otherwise (or if the image fails
 * to load) the existing file-type icon fallback.
 */
export default function FileThumb({
  src,
  fileType,
  className,
}: {
  src?: string | null;
  fileType: string;
  className?: string;
}) {
  // Track WHICH src failed so a new src (e.g. after replacing the thumbnail) is retried.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = !!src && failedSrc === src;

  if (src && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailedSrc(src ?? null)}
        className={cn("w-full h-full object-cover", className)}
      />
    );
  }
  return <>{getFileTypeIcon(fileType)}</>;
}
