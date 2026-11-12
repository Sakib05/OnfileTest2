"use client";
import React from "react";
import FileThumb from "@/components/ui/FileThumb";
import { previewAspectRatio, type DownloadFileInfo } from "@/lib/download";

/**
 * Large artwork for the file page. The frame uses the thumbnail's own aspect
 * ratio (clamped), so the image is scaled uniformly — never stretched. Without
 * a thumbnail (or if it fails to load) FileThumb falls back to the branded
 * FileTypeArt, so there is never a broken-image placeholder.
 */
export default function FileHero({ file }: { file: DownloadFileInfo }) {
  return (
    <div
      className="relative w-full overflow-hidden rounded-3xl border border-app bg-secondary shadow-app-md"
      style={{ aspectRatio: previewAspectRatio(file.thumbnailWidth, file.thumbnailHeight) }}
      data-testid="file-hero"
    >
      <FileThumb url={file.thumbnailUrl} fileType={file.fileType} title={file.title} mimeType={file.mimeType} alt={file.title} eager />
    </div>
  );
}
