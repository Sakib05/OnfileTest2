"use client";
import React, { useState } from "react";
import { cn } from "@/lib/utils";
import { isLongDescription } from "@/lib/viewer";

/**
 * Short description (2 lines) that expands to the full text when clicked and collapses again.
 * Short or missing descriptions render without any toggle; a missing description renders nothing at all
 * (or a quiet placeholder line while the details are still loading, so the layout doesn't jump).
 */
export default function DescriptionBlock({ text, loading = false }: { text?: string | null; loading?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const description = text?.trim() ?? "";

  if (!description) {
    return loading ? <div className="h-4 w-2/3 rounded bg-secondary animate-pulse-brand" aria-hidden="true" data-testid="description-loading" /> : null;
  }

  if (!isLongDescription(description)) {
    return <p className="text-sm text-secondary leading-relaxed whitespace-pre-line break-words" data-testid="description">{description}</p>;
  }

  return (
    <button
      type="button"
      onClick={() => setExpanded((v) => !v)}
      aria-expanded={expanded}
      className="block w-full min-w-0 text-left rounded-lg focus-visible:outline-2 focus-visible:outline-[#FF6115]"
      data-testid="description"
    >
      <span className={cn("block text-sm text-secondary leading-relaxed whitespace-pre-line break-words", !expanded && "line-clamp-2")}>{description}</span>
      <span className="inline-block mt-1 text-xs font-semibold text-brand">{expanded ? "Show less" : "Show more"}</span>
    </button>
  );
}
