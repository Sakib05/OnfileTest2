"use client";
import React, { useEffect, useState } from "react";
import { Bookmark, ListMusic, FileText, Trash2, X } from "lucide-react";
import FileThumb from "@/components/ui/FileThumb";
import { useToast } from "@/components/ui/Toast";
import { savedHref } from "@/lib/savedItems";
import { useSavedItems } from "@/lib/useSavedItems";
import { cn } from "@/lib/utils";

/**
 * Device-based Saved Items. Appears only after the first item has been saved.
 *  - Desktop (md+): floating pill button + right-hand side drawer.
 *  - Mobile: floating round icon + bottom sheet.
 * Entries live in this browser's localStorage only (no accounts, no server records).
 * Opening an entry loads the normal public page, which runs every usual server-side access check.
 */
export default function SavedItemsWidget() {
  const { items, count, remove, clear } = useSavedItems();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const visible = count > 0;
  const isOpen = open && visible;

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [isOpen]);

  if (!visible) return null;

  const close = () => {
    setOpen(false);
    setConfirmClear(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Saved items (${count})`}
        aria-haspopup="dialog"
        data-testid="saved-fab"
        className="fixed z-40 right-4 bottom-[calc(env(safe-area-inset-bottom)+1rem)] h-12 w-12 md:w-auto md:px-4 md:gap-2 rounded-full bg-brand text-white shadow-app-lg inline-flex items-center justify-center text-sm font-semibold active:scale-95 transition-transform focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#FF6115]"
      >
        <Bookmark size={20} aria-hidden="true" />
        <span className="hidden md:inline">Saved</span>
        <span className="absolute -top-1 -right-1 md:static min-w-5 h-5 px-1 rounded-full bg-card text-[#FF6115] border border-[#FF6115] md:border-0 text-[11px] font-bold inline-flex items-center justify-center" data-testid="saved-count">
          {count}
        </span>
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50" data-testid="saved-drawer-root">
          <div className="absolute inset-0 bg-[rgba(0,0,0,0.5)] backdrop-blur-sm animate-fade-in" onClick={close} aria-hidden="true" />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Saved items"
            data-testid="saved-drawer"
            className={cn(
              "absolute bg-card border-app flex flex-col shadow-app-lg",
              // mobile: bottom sheet
              "inset-x-0 bottom-0 max-h-[82vh] rounded-t-3xl border-t animate-slide-up",
              // desktop: side drawer
              "md:inset-x-auto md:inset-y-0 md:right-0 md:bottom-auto md:w-[26rem] md:max-h-none md:rounded-none md:rounded-l-3xl md:border-t-0 md:border-l"
            )}
            style={{ background: "var(--color-bg-card)" }}
          >
            <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-app">
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-primary">Saved items ({count})</h2>
                <p className="text-xs text-secondary mt-1 leading-snug">Stored on this device and browser only — no account needed. Clearing your browser data removes them.</p>
              </div>
              <button type="button" onClick={close} aria-label="Close saved items" className="w-9 h-9 -mr-2 flex-shrink-0 flex items-center justify-center rounded-full hover:bg-secondary">
                <X size={18} className="text-secondary" aria-hidden="true" />
              </button>
            </div>

            <ul className="flex-1 overflow-y-auto overscroll-contain px-3 py-3 flex flex-col gap-2" data-testid="saved-list">
              {items.map((item) => (
                <li key={`${item.type}:${item.id}`} className="flex items-center gap-2 rounded-xl border border-app bg-card pr-1 min-w-0">
                  <a href={savedHref(item)} className="flex-1 min-w-0 flex items-center gap-3 p-2 rounded-xl hover:bg-secondary" data-testid="saved-open">
                    <span className="w-16 aspect-video rounded-lg bg-secondary relative overflow-hidden flex-shrink-0 border border-app">
                      <FileThumb url={item.thumbnailUrl} fileType={null} />
                    </span>
                    <span className="min-w-0 flex-1 block">
                      <span className="block text-sm font-semibold text-primary truncate">{item.title}</span>
                      <span className="mt-0.5 text-xs text-secondary inline-flex items-center gap-1">
                        {item.type === "playlist" ? <ListMusic size={12} aria-hidden="true" /> : <FileText size={12} aria-hidden="true" />}
                        {item.type === "playlist" ? "Playlist" : "File"}
                      </span>
                    </span>
                  </a>
                  <button
                    type="button"
                    onClick={() => {
                      if (!remove(item.type, item.id)) toast("Couldn't update saved items.", "error");
                    }}
                    aria-label={`Remove ${item.title}`}
                    data-testid="saved-remove"
                    className="w-10 h-10 flex-shrink-0 flex items-center justify-center rounded-full text-muted hover:text-red-500 hover:bg-secondary"
                  >
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>

            <div className="px-5 py-3 border-t border-app pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
              {confirmClear ? (
                <div className="flex items-center gap-2" role="alert">
                  <p className="text-xs text-secondary flex-1">Remove all saved items from this device?</p>
                  <button type="button" onClick={() => setConfirmClear(false)} className="btn-secondary !px-3 !py-2 text-xs">Cancel</button>
                  <button
                    type="button"
                    data-testid="saved-clear-confirm"
                    onClick={() => {
                      if (clear()) toast("Saved items cleared", "info");
                      else toast("Couldn't update saved items.", "error");
                      close();
                    }}
                    className="px-3 py-2 rounded-xl bg-red-500 text-white text-xs font-semibold"
                  >
                    Clear all
                  </button>
                </div>
              ) : (
                <button type="button" onClick={() => setConfirmClear(true)} data-testid="saved-clear" className="text-xs font-semibold text-secondary hover:text-red-500 min-h-10">
                  Clear all saved items
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
