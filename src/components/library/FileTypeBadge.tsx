import React from "react";
import { Archive, File as FileIcon, FileText, Image as ImageIcon, Music, Video, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface TypeStyle {
  icon: LucideIcon;
  /** Human label — exposed to assistive tech / tooltips only, never printed on the thumbnail. */
  label: string;
  /** Category colour applied to the icon (light enough to read on the dark pill in both themes). */
  tint: string;
}

const TYPES: Record<string, TypeStyle> = {
  video: { icon: Video, label: "Video", tint: "text-purple-300" },
  audio: { icon: Music, label: "Audio", tint: "text-blue-300" },
  document: { icon: FileText, label: "Document", tint: "text-green-300" },
  image: { icon: ImageIcon, label: "Image", tint: "text-pink-300" },
  archive: { icon: Archive, label: "Archive", tint: "text-yellow-300" },
  other: { icon: FileIcon, label: "File", tint: "text-gray-200" },
};

/**
 * File-type badge pinned to the TOP-RIGHT corner of a thumbnail — icon only (no text).
 *
 * It must be rendered inside the thumbnail frame (which is `relative overflow-hidden`), so it
 * is attached to the artwork and follows it when the card changes size. The badge is a
 * translucent dark circle with a category-coloured icon: readable over any image and over the
 * FileTypeArt fallback, in both the light and the dark theme (it does not depend on the page colours).
 * The category is still announced to screen readers (`aria-label`) and shown as a tooltip.
 */
export default function FileTypeBadge({ fileType, className }: { fileType: string | null | undefined; className?: string }) {
  const type = (fileType || "other").toLowerCase();
  const { icon: Icon, label, tint } = TYPES[type] ?? TYPES.other;
  return (
    <span
      data-testid="file-type-badge"
      data-file-type={type}
      role="img"
      aria-label={label}
      title={label}
      className={cn(
        "pointer-events-none absolute top-1.5 right-1.5 z-10 inline-flex h-6 w-6 items-center justify-center rounded-full",
        "bg-black/60 text-white ring-1 ring-white/15 backdrop-blur-sm",
        className
      )}
    >
      <Icon size={13} strokeWidth={2.25} aria-hidden="true" className={cn("flex-shrink-0", tint)} />
    </span>
  );
}
