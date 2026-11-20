"use client";
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface MenuAction {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  action: () => void;
  /** Tailwind text colour class for the icon + label. */
  color?: string;
  /** Draws a divider above this item (destructive items are always separated). */
  separated?: boolean;
  destructive?: boolean;
  /** Item stays visible but dimmed; selecting it still runs `action` (used to explain WHY it's unavailable). */
  unavailable?: boolean;
  /** Small second line under the label (e.g. "Publish first"). */
  hint?: string;
}

const WIDTH = 232;
const ITEM_H = 48;
const MARGIN = 8;

/**
 * Item action menu. Rendered once at the top of the Library with `position: fixed`
 * next to the tapped "⋯" button, so it is never clipped by a horizontally
 * scrolling Home row. It flips above the button when there is no room below and, when it
 * fits neither way (short phone screens, many items), it is pinned inside the viewport
 * and scrolls internally. Arrow keys / Home / End move between items.
 */
export default function LibraryMenu({ anchor, actions, onClose }: { anchor: DOMRect; actions: MenuAction[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number }>({
    top: anchor.bottom + 4,
    left: anchor.right - WIDTH,
    maxHeight: 9999,
  });

  useLayoutEffect(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(WIDTH, vw - MARGIN * 2);
    const natural = ref.current?.scrollHeight || actions.length * ITEM_H + 8;
    const maxHeight = vh - MARGIN * 2;
    const height = Math.min(natural, maxHeight);
    const left = Math.min(Math.max(anchor.right - width, MARGIN), Math.max(vw - width - MARGIN, MARGIN));
    const below = anchor.bottom + 4;
    let top: number;
    if (below + height <= vh - MARGIN) top = below;
    else if (anchor.top - height - 4 >= MARGIN) top = anchor.top - height - 4;
    else top = Math.max(MARGIN, vh - MARGIN - height);
    // Positioning needs the measured menu height, which only exists after layout.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPos({ top, left, maxHeight });
  }, [anchor, actions.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onClose();
      const nodes = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
      const i = nodes.indexOf(document.activeElement as HTMLElement);
      const go = (n: number) => {
        e.preventDefault();
        nodes[(n + nodes.length) % nodes.length]?.focus();
      };
      if (e.key === "ArrowDown") go(i + 1);
      else if (e.key === "ArrowUp") go(i - 1);
      else if (e.key === "Home") go(0);
      else if (e.key === "End") go(nodes.length - 1);
    };
    // Scrolling INSIDE the menu must not close it; scrolling the page behind it does.
    const onScroll = (e: Event) => {
      if (e.target instanceof Node && ref.current?.contains(e.target)) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onClose);
    window.addEventListener("scroll", onScroll, true);
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [onClose]);

  return (
    <>
      <div className="fixed inset-0 z-[45]" onClick={onClose} aria-hidden="true" />
      <div
        ref={ref}
        role="menu"
        aria-label="File actions"
        className="fixed z-50 bg-card border border-app rounded-2xl shadow-app-lg overflow-y-auto overscroll-contain animate-scale-in py-1"
        style={{ top: pos.top, left: pos.left, width: Math.min(WIDTH, typeof window !== "undefined" ? window.innerWidth - MARGIN * 2 : WIDTH), maxHeight: pos.maxHeight }}
      >
        {actions.map(({ icon: Icon, label, action, color = "text-primary", separated, destructive, unavailable, hint }) => {
          const tone = destructive ? "text-red-500" : color;
          return (
            <React.Fragment key={label}>
              {(separated || destructive) && <div role="separator" className="my-1 h-px bg-[var(--color-border)]" />}
              <button
                type="button"
                role="menuitem"
                aria-disabled={unavailable || undefined}
                data-unavailable={unavailable ? "true" : undefined}
                onClick={() => {
                  action();
                  onClose();
                }}
                className={cn(
                  "flex items-center gap-3 px-4 w-full hover:bg-secondary active:bg-secondary focus-visible:bg-secondary outline-none transition-colors text-sm text-left",
                  unavailable && "opacity-55"
                )}
                style={{ minHeight: ITEM_H }}
              >
                <Icon size={18} className={cn("flex-shrink-0", tone)} />
                <span className="min-w-0 flex-1 py-1.5">
                  <span className={cn("block font-medium leading-tight", tone)}>{label}</span>
                  {hint && <span className="block text-[11px] leading-tight text-muted mt-0.5">{hint}</span>}
                </span>
              </button>
            </React.Fragment>
          );
        })}
      </div>
    </>
  );
}
