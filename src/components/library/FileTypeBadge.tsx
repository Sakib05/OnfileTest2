import React from "react";
import { cn } from "@/lib/utils";

/** Small coloured dot per category — keeps each type distinguishable on a neutral, translucent badge. */
const DOT: Record<string, string> = {
  video: "bg-purple-400",
  audio: "bg-blue-400",
  document: "bg-green-400",
  image: "bg-pink-400",
  archive: "bg-yellow-400",
};

/**
 * File-type tag pinned to the TOP-RIGHT corner of a thumbnail.
 *
 * It must be rendered inside the thumbnail frame (which is `relative overflow-hidden`), so it
 * is attached to the artwork and follows it when the card changes size. The badge is a
 * translucent dark pill with white text: readable over any image and over the FileTypeArt
 * fallback, in both the light and the dark theme (it does not depend on the page colours).
 */
export default function FileTypeBadge({ fileType, className }: { fileType: string | null | undefined; className?: string }) {
  const type = (fileType || "other").toLowerCase();
  return (
    <span
      data-testid="file-type-badge"
      data-file-type={type}
      className={cn(
        "pointer-events-none absolute top-1.5 right-1.5 z-10 inline-flex max-w-[calc(100%-12px)] items-center gap-1 rounded-full",
        "bg-black/60 px-1.5 py-[3px] text-[10px] font-semibold uppercase leading-none tracking-wide text-white",
        "ring-1 ring-white/15 backdrop-blur-sm",
        className
      )}
    >
      <span aria-hidden="true" className={cn("h-1.5 w-1.5 flex-shrink-0 rounded-full", DOT[type] ?? "bg-gray-300")} />
      <span className="truncate">{type}</span>
    </span>
  );
}
