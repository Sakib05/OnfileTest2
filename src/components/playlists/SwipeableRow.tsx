"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { clampOffset, lockAxis, settleOpen, type Axis } from "@/lib/swipe";

/** Width (px) of the revealed Remove panel. Comfortably above the 44px touch-target guideline. */
export const SWIPE_ACTION_WIDTH = 92;

interface Gesture {
  pointerId: number;
  x: number;
  y: number;
  lastX: number;
  lastT: number;
  velocity: number;
  offset: number;
  wasOpen: boolean;
  axis: Axis;
}

/**
 * A row that slides LEFT (right-to-left swipe) to reveal a destructive Remove action on its
 * right edge — the replacement for the old "⋯" menu.
 *
 * Gesture design
 *  - Pointer Events, so one code path serves Android/iOS touch, pen and mouse.
 *  - `touch-action: pan-y` on the sliding layer: the browser keeps vertical scrolling, and we only
 *    receive the horizontal motion. The first few pixels decide the axis (`lockAxis`): a vertical
 *    gesture never moves the row, so scrolling the list can't reveal or trigger Remove.
 *  - Anything marked `data-no-swipe` (the drag handle) never starts a swipe, so drag-and-drop
 *    reordering is untouched.
 *  - Opening is controlled by the parent (`open` / `onOpenChange`), so only one row is open at a
 *    time. Releasing short of the threshold springs back; a pointer cancel restores the rest state.
 *  - A swipe never counts as a tap: the click that follows a drag is swallowed, and a tap on an
 *    open row just closes it.
 *
 * Accessibility: the Remove button is always in the accessibility tree and focusable. Focusing it
 * (Tab / screen-reader navigation) reveals it, so swipe is never the only way to remove a file.
 * ArrowLeft opens and ArrowRight / Escape closes while focus is inside the row.
 */
export default function SwipeableRow({
  open,
  onOpenChange,
  onSwipeStart,
  onRemove,
  removeLabel,
  disabled = false,
  removing = false,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The user started dragging THIS row (the parent closes any other open row). */
  onSwipeStart?: () => void;
  onRemove: () => void;
  removeLabel: string;
  /** Blocks swiping and removing (another operation is in flight). */
  disabled?: boolean;
  removing?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const W = SWIPE_ACTION_WIDTH;
  const rootRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const suppressClick = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [live, setLive] = useState(0);

  const x = dragging ? live : open ? -W : 0;
  const revealed = dragging ? live < -1 : open;

  useEffect(
    () => () => {
      gesture.current = null;
    },
    []
  );

  const endGesture = useCallback(() => {
    gesture.current = null;
    setDragging(false);
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if ((e.target as Element).closest("[data-no-swipe]")) return; // drag handle → reorder, not swipe
    gesture.current = {
      pointerId: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      lastX: e.clientX,
      lastT: e.timeStamp,
      velocity: 0,
      offset: open ? -W : 0,
      wasOpen: open,
      axis: null,
    };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;

    if (g.axis === null) {
      const axis = lockAxis(dx, dy);
      if (!axis) return;
      g.axis = axis;
      if (axis === "y") return; // a scroll — leave it entirely to the browser
      onSwipeStart?.();
      setDragging(true);
      try {
        layerRef.current?.setPointerCapture?.(e.pointerId);
      } catch {
        /* pointer already gone — harmless */
      }
    }
    if (g.axis !== "x") return;

    const dt = e.timeStamp - g.lastT;
    if (dt > 0) g.velocity = 0.6 * ((e.clientX - g.lastX) / dt) + 0.4 * g.velocity;
    g.lastX = e.clientX;
    g.lastT = e.timeStamp;

    g.offset = clampOffset((g.wasOpen ? -W : 0) + dx, W);
    setLive(g.offset);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    if (g.axis === "x") {
      suppressClick.current = true; // the click that follows a swipe is not a tap
      window.setTimeout(() => {
        suppressClick.current = false;
      }, 60);
      const idle = e.timeStamp - g.lastT > 80; // finger paused before lifting → not a flick
      const next = settleOpen({ offset: g.offset, velocity: idle ? 0 : g.velocity, width: W, wasOpen: g.wasOpen });
      endGesture();
      if (next !== open) onOpenChange(next);
      return;
    }
    gesture.current = null;
  };

  const onPointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    endGesture(); // gesture abandoned (e.g. the browser took over for scrolling) → back to the rest state
  };

  const onClickCapture = (e: React.MouseEvent<HTMLDivElement>) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      e.stopPropagation();
      e.preventDefault();
      return;
    }
    if (open) {
      // Tapping an open row closes it instead of triggering the row's own action.
      e.stopPropagation();
      e.preventDefault();
      onOpenChange(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled || (e.target as Element).closest("[data-no-swipe]")) return;
    if (e.key === "ArrowLeft" && !open) {
      e.preventDefault();
      onOpenChange(true);
    } else if ((e.key === "ArrowRight" || e.key === "Escape") && open) {
      e.preventDefault();
      onOpenChange(false);
    }
  };

  return (
    <div
      ref={rootRef}
      data-testid="swipe-row"
      data-open={open}
      className={cn("relative overflow-hidden rounded-xl", className)}
      onKeyDown={onKeyDown}
    >
      {/* Action panel — sits underneath the row and is uncovered as the row slides left. */}
      <div
        className="absolute inset-y-0 right-0 flex bg-red-600 transition-opacity duration-200 motion-reduce:transition-none"
        style={{ width: W, opacity: revealed ? 1 : 0 }}
      >
        <button
          type="button"
          data-testid="swipe-remove"
          aria-label={removeLabel}
          disabled={disabled && !removing}
          onClick={onRemove}
          onFocus={() => onOpenChange(true)}
          onBlur={(e) => {
            if (!rootRef.current?.contains(e.relatedTarget as Node | null)) onOpenChange(false);
          }}
          className="flex-1 flex flex-col items-center justify-center gap-1 text-white text-xs font-semibold active:bg-red-700 focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-white disabled:opacity-60"
        >
          {removing ? <Loader2 size={18} className="animate-spin" aria-hidden="true" /> : <Trash2 size={18} aria-hidden="true" />}
          <span>{removing ? "Removing…" : "Remove"}</span>
        </button>
      </div>

      {/* Sliding layer. Opaque, so the panel is fully hidden while closed. */}
      <div
        ref={layerRef}
        data-testid="swipe-layer"
        className="relative bg-secondary select-none"
        style={{
          transform: `translate3d(${x}px,0,0)`,
          transition: dragging ? "none" : "transform 220ms cubic-bezier(0.22, 1, 0.36, 1)",
          touchAction: "pan-y",
          willChange: dragging ? "transform" : undefined,
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onClickCapture={onClickCapture}
      >
        {children}
      </div>
    </div>
  );
}
