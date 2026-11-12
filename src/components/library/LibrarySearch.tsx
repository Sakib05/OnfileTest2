"use client";
import React, { forwardRef } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Collapsible search field shown beneath the Library header when the header's
 * search icon is tapped. It animates its height/opacity; while closed it is
 * `inert` (not focusable, hidden from assistive tech) and takes no vertical space.
 */
const LibrarySearch = forwardRef<
  HTMLInputElement,
  { open: boolean; query: string; onQueryChange: (q: string) => void; onClose: () => void }
>(function LibrarySearch({ open, query, onQueryChange, onClose }, ref) {
  return (
    <div
      className={cn(
        "grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none",
        open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
      )}
      inert={!open}
      data-testid="library-search"
      data-open={open}
    >
      <div className="overflow-hidden min-h-0">
        <div className="relative flex items-center pt-3 pb-0.5">
          <Search size={16} className="absolute left-3.5 text-muted pointer-events-none" aria-hidden="true" />
          <input
            ref={ref}
            type="search"
            role="searchbox"
            enterKeyHint="search"
            autoComplete="off"
            className="input-app pl-10 pr-12 py-2.5 text-sm"
            placeholder="Search files & playlists..."
            aria-label="Search files and playlists"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
            }}
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close search"
            className="absolute right-1 w-10 h-10 rounded-xl flex items-center justify-center text-secondary hover:text-primary active:bg-card transition-colors"
          >
            <X size={18} />
          </button>
        </div>
      </div>
    </div>
  );
});

export default LibrarySearch;
