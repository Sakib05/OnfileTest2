"use client";
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface MenuAction {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  action: () => void;
  /** Tailwind text colour class for the icon + label. */
  color?: string;
}

const WIDTH = 188;
const ITEM_H = 44;
const MARGIN = 8;

/**
 * Item action menu. Rendered once at the top of the Library with `position: fixed`
 * next to the tapped "⋯" button, so it is never clipped by a horizontally
 * scrolling Home row, and it flips above the button when there is no room below.
 */
export default function LibraryMenu({ anchor, actions, onClose }: { anchor: DOMRect; actions: MenuAction[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: anchor.bottom + 4, left: anchor.right - WIDTH });

  useLayoutEffect(() => {
    const height = ref.current?.offsetHeight || actions.length * ITEM_H + 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.min(Math.max(anchor.right - WIDTH, MARGIN), Math.max(vw - WIDTH - MARGIN, MARGIN));
    const below = anchor.bottom + 4;
    const top = below + height > vh - MARGIN ? Math.max(anchor.top - height - 4, MARGIN) : below;
    // Positioning needs the measured menu height, which only exists after layout.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPos({ top, left });
  }, [anchor, actions.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onClose);
    window.addEventListener("scroll", onClose, true);
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [onClose]);

  return (
    <>
      <div className="fixed inset-0 z-[45]" onClick={onClose} aria-hidden="true" />
      <div
        ref={ref}
        role="menu"
        className="fixed z-50 bg-card border border-app rounded-2xl shadow-app-lg overflow-hidden animate-scale-in py-1"
        style={{ top: pos.top, left: pos.left, width: WIDTH }}
      >
        {actions.map(({ icon: Icon, label, action, color = "text-primary" }) => (
          <button
            key={label}
            role="menuitem"
            onClick={() => {
              action();
              onClose();
            }}
            className="flex items-center gap-3 px-4 w-full hover:bg-secondary active:bg-secondary transition-colors text-sm text-left"
            style={{ height: ITEM_H }}
          >
            <Icon size={16} className={color} />
            <span className={cn("font-medium", color)}>{label}</span>
          </button>
        ))}
      </div>
    </>
  );
}
