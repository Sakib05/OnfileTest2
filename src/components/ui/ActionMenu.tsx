"use client";
import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { MoreVertical, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ActionMenuItem {
  key: string;
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  /** Destructive actions are tinted red and separated from the rest. */
  destructive?: boolean;
  disabled?: boolean;
}

/**
 * Compact "more actions" (⋮) menu following the WAI-ARIA menu-button pattern:
 *  - button: aria-haspopup="menu" / aria-expanded / aria-controls
 *  - ArrowDown/ArrowUp on the button opens and focuses the first/last item (Enter/Space/click open too)
 *  - ArrowUp/Down/Home/End move, Escape closes and returns focus to the button, Tab closes
 *  - tapping/clicking outside closes; selecting an item closes first, then runs the action
 *  - it opens downward, flips upward when there is no room below, is right-aligned to the button
 *    and never wider than the viewport, so it can't leave the screen on a small phone
 */
export default function ActionMenu({
  items,
  label = "More actions",
  disabled,
  className,
}: {
  items: ActionMenuItem[];
  label?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [flipUp, setFlipUp] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const focusOnOpen = useRef<"first" | "last">("first");
  const menuId = useId();

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }, []);

  // Close on any press outside the menu + button.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: Event) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open]);

  // Flip upward when the menu would run off the bottom of the viewport; focus the requested item.
  useLayoutEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    const btn = buttonRef.current;
    if (menu && btn) {
      const need = menu.offsetHeight + 8;
      const rect = btn.getBoundingClientRect();
      const below = window.innerHeight - rect.bottom;
      setFlipUp(below < need && rect.top > below);
    }
    const enabled = menu?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])');
    if (enabled && enabled.length) (focusOnOpen.current === "last" ? enabled[enabled.length - 1] : enabled[0]).focus();
  }, [open]);

  const onButtonKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      focusOnOpen.current = e.key === "ArrowUp" ? "last" : "first";
      setOpen(true);
    }
  };

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    const nodes = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? []);
    const i = nodes.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => {
      e.preventDefault();
      nodes[(n + nodes.length) % nodes.length]?.focus();
    };
    switch (e.key) {
      case "ArrowDown": return go(i + 1);
      case "ArrowUp": return go(i - 1);
      case "Home": return go(0);
      case "End": return go(nodes.length - 1);
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        return close(true);
      case "Tab":
        return close(false);
    }
  };

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        data-testid="action-menu-button"
        onClick={() => {
          focusOnOpen.current = "first";
          setOpen((o) => !o);
        }}
        onKeyDown={onButtonKeyDown}
        className="w-11 h-11 inline-flex items-center justify-center rounded-xl bg-secondary border border-app text-primary disabled:opacity-60 active:scale-95 transition-transform"
      >
        <MoreVertical size={18} aria-hidden="true" />
      </button>

      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          data-testid="action-menu"
          onKeyDown={onMenuKeyDown}
          className={cn(
            "absolute right-0 z-30 w-56 max-w-[calc(100vw-2rem)] rounded-2xl border border-app bg-card shadow-app-lg p-1.5 animate-fade-in",
            flipUp ? "bottom-full mb-1.5" : "top-full mt-1.5"
          )}
        >
          {items.map((item, idx) => {
            const Icon = item.icon;
            const separate = item.destructive && idx > 0;
            return (
              <React.Fragment key={item.key}>
                {separate && <div role="separator" className="my-1 h-px bg-[var(--color-border)]" />}
                <button
                  type="button"
                  role="menuitem"
                  disabled={item.disabled}
                  data-testid={`menu-item-${item.key}`}
                  onClick={() => {
                    close(false);
                    item.onSelect();
                  }}
                  className={cn(
                    "w-full min-h-11 flex items-center gap-3 px-3 rounded-xl text-sm font-medium text-left outline-none transition-colors disabled:opacity-50",
                    item.destructive
                      ? "text-red-500 hover:bg-red-500/10 focus-visible:bg-red-500/10"
                      : "text-primary hover:bg-secondary focus-visible:bg-secondary"
                  )}
                >
                  <Icon size={16} aria-hidden="true" className="flex-shrink-0" />
                  <span className="truncate">{item.label}</span>
                </button>
              </React.Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}
