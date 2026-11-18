"use client";
import React from "react";
import FileThumb from "@/components/ui/FileThumb";
import { previewAspectRatio, type DownloadFileInfo } from "@/lib/download";

/**
 * Large artwork for the selected file. The frame uses the thumbnail's own aspect ratio (clamped) when it is known,
 * and a steady 16:9 otherwise, so the image is scaled uniformly — never stretched — and switching files in a
 * playlist doesn't make the page jump. Without a thumbnail (or if it fails to load) FileThumb falls back to the
 * branded FileTypeArt, so there is never a broken-image placeholder.
 */
export default function FileHero({ file, fixedRatio = false }: { file: DownloadFileInfo; fixedRatio?: boolean }) {
  return (
    <div
      className="relative w-full overflow-hidden rounded-3xl border border-app bg-secondary shadow-app-md"
      style={{ aspectRatio: fixedRatio ? 16 / 9 : previewAspectRatio(file.thumbnailWidth, file.thumbnailHeight) }}
      data-testid="file-hero"
    >
      <FileThumb key={file.slug} url={file.thumbnailUrl} fileType={file.fileType} title={file.title} mimeType={file.mimeType} alt={file.title} eager />
    </div>
  );
}
