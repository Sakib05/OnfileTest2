"use client";
import React, { forwardRef } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Collapsible search field shown beneath the Library header when the header's
 * search icon is tapped. It animates its height/opacity; while closed it is
 * `inert` (not focusable, hidden from assistive tech) and takes no vertical space.
 *
 * Layout: [ search icon ][ input … ][ close ] — one flex row styled as the field.
 * The icon and the close button are normal flex children (NOT absolutely positioned over a
 * padded input), so the placeholder always starts after the icon and can never overlap it,
 * whatever padding the shared `.input-app` style or the Android WebView applies to inputs.
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
        <div className="pt-3 pb-0.5">
          <div
            data-testid="library-search-field"
            className={cn(
              "flex items-center gap-2 h-11 w-full min-w-0 pl-3.5 pr-1 rounded-xl border-[1.5px] border-app bg-secondary",
              "transition-[border-color,box-shadow] duration-200 focus-within:border-[#FF6115] focus-within:shadow-[0_0_0_3px_rgba(255,97,21,0.15)]"
            )}
          >
            <Search size={16} className="flex-shrink-0 text-muted" aria-hidden="true" data-testid="library-search-icon" />
            <input
              ref={ref}
              type="search"
              role="searchbox"
              enterKeyHint="search"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              className={cn(
                "flex-1 min-w-0 h-full p-0 m-0 bg-transparent border-0 outline-none shadow-none text-primary text-sm",
                "placeholder:text-muted placeholder:truncate appearance-none",
                // Hide the browser's own clear (×) so there is only ever our close button.
                "[&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden"
              )}
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
              className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-secondary hover:text-primary active:bg-card transition-colors"
            >
              <X size={18} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});

export default LibrarySearch;
