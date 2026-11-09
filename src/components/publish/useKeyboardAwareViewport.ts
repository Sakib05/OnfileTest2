"use client";
import { useEffect, useState, type RefObject } from "react";
import { coveredBottomInset, isKeyboardOpen, KEYBOARD_MIN_SHRINK_PX, revealDelta } from "@/lib/keyboardViewport";

const NON_TEXT_INPUT_TYPES = new Set([
  "button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit",
]);

function isEditable(el: Element | null): el is HTMLElement {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
  if (el instanceof HTMLInputElement) return !NON_TEXT_INPUT_TYPES.has(el.type) && !el.readOnly && !el.disabled;
  return el instanceof HTMLElement && el.isContentEditable;
}

/**
 * Keeps the focused text field visible above the on-screen keyboard inside
 * `rootRef` (the publishing wizard). Event-driven only — no timers, no
 * polling, no repeated focusing, no assumed keyboard height.
 *
 * Why this is needed: depending on the host, the keyboard either
 *  (a) resizes the whole webview / layout viewport (Telegram Android), or
 *  (b) only shrinks `window.visualViewport` and leaves the layout viewport
 *      full-size (Chrome Android default).
 * In both cases the page's fixed floating bottom nav and fixed bottom padding
 * can leave the active field under the keyboard / nav. This hook:
 *  1. detects "keyboard open" from visualViewport + focus (touch devices only),
 *  2. flags `<html data-keyboard-open>` so the floating nav gets out of the way
 *     while it is open (see globals.css),
 *  3. returns the covered bottom inset (px) so the caller can add scroll room
 *     in case (b), and
 *  4. scrolls the page by the minimal amount needed to reveal the focused
 *     field, once per viewport change / focus change.
 * Everything is undone on unmount, so other screens are unaffected.
 *
 * @returns bottom inset (px) currently covered by the keyboard (0 when closed
 *          or when the layout viewport itself was resized).
 */
export function useKeyboardAwareViewport(rootRef: RefObject<HTMLElement | null>): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    const coarseQuery = window.matchMedia?.("(pointer: coarse)");
    const portraitQuery = window.matchMedia?.("(orientation: portrait)");
    const html = document.documentElement;

    const visibleHeight = () => vv?.height ?? window.innerHeight;

    let baseline = visibleHeight();
    let resetBaseline = false;
    let frame = 0;
    let wantReveal = false;
    let lastOpen = false;
    let lastInset = 0;

    const activeEditableInRoot = (): HTMLElement | null => {
      const el = document.activeElement;
      return isEditable(el) && rootRef.current?.contains(el) ? el : null;
    };

    const run = () => {
      frame = 0;
      const field = activeEditableInRoot();
      const h = visibleHeight();

      if (resetBaseline) {
        baseline = h; // orientation changed: old baseline is meaningless
        resetBaseline = false;
      }
      const shrunk = baseline - h >= KEYBOARD_MIN_SHRINK_PX;
      if (!shrunk) baseline = field ? Math.max(baseline, h) : h;

      const open = isKeyboardOpen({
        baselineHeight: baseline,
        viewportHeight: h,
        editableFocused: !!field,
        coarsePointer: !!coarseQuery?.matches,
      });

      if (open !== lastOpen) {
        lastOpen = open;
        if (open) html.setAttribute("data-keyboard-open", "true");
        else html.removeAttribute("data-keyboard-open");
      }

      const nextInset = open ? coveredBottomInset(window.innerHeight, h) : 0;
      if (nextInset !== lastInset) {
        lastInset = nextInset;
        setInset(nextInset);
      }

      if (wantReveal && field && open) {
        wantReveal = false;
        const delta = revealDelta(field.getBoundingClientRect(), { top: vv?.offsetTop ?? 0, height: h });
        // "instant": html has `scroll-behavior: smooth`, which would otherwise
        // animate this and fight the browser's own keyboard handling.
        if (delta !== 0) window.scrollBy({ top: delta, behavior: "instant" });
      }
      wantReveal = false;
    };

    const schedule = (reveal: boolean) => {
      if (reveal) wantReveal = true;
      if (!frame) frame = requestAnimationFrame(run);
    };

    const onViewportChange = () => schedule(true);
    const onFocusIn = () => schedule(true);
    const onFocusOut = () => schedule(false);
    const onOrientation = () => {
      resetBaseline = true;
      schedule(false);
    };

    vv?.addEventListener("resize", onViewportChange);
    window.addEventListener("resize", onViewportChange);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    portraitQuery?.addEventListener?.("change", onOrientation);

    return () => {
      vv?.removeEventListener("resize", onViewportChange);
      window.removeEventListener("resize", onViewportChange);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      portraitQuery?.removeEventListener?.("change", onOrientation);
      if (frame) cancelAnimationFrame(frame);
      html.removeAttribute("data-keyboard-open");
    };
  }, [rootRef]);

  return inset;
}
