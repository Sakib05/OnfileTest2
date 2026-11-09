/**
 * Pure helpers for on-screen-keyboard handling. No DOM access here so the
 * logic can be unit-tested; the DOM wiring lives in
 * src/components/publish/useKeyboardAwareViewport.ts.
 *
 * Nothing in here assumes a keyboard height. The keyboard is detected as
 * "an editable element is focused AND the visible viewport got meaningfully
 * shorter than it was before", and the covered area is measured from
 * `window.visualViewport`.
 */

/**
 * Minimum shrink (px) of the visible viewport, while an editable element is
 * focused, to count as "a keyboard is open". This is a noise filter (URL-bar
 * collapse, small toolbar changes are < ~100px), not a keyboard height.
 */
export const KEYBOARD_MIN_SHRINK_PX = 120;

/** Breathing room kept between the active field and the edge of the visible area. */
export const REVEAL_MARGIN_PX = 16;

export interface KeyboardStateInput {
  /** Visible-viewport height seen while no keyboard was open. */
  baselineHeight: number;
  /** Current visible-viewport height (visualViewport.height, or innerHeight). */
  viewportHeight: number;
  editableFocused: boolean;
  /** Touch-first device (pointer: coarse). Desktop window resizes must not count. */
  coarsePointer: boolean;
}

export function isKeyboardOpen({ baselineHeight, viewportHeight, editableFocused, coarsePointer }: KeyboardStateInput): boolean {
  if (!editableFocused || !coarsePointer) return false;
  return baselineHeight - viewportHeight >= KEYBOARD_MIN_SHRINK_PX;
}

/**
 * Bottom area (px) of the layout viewport that is covered. Non-zero when the
 * browser keeps the layout viewport full-size and only shrinks the *visual*
 * viewport (Chrome's default `resizes-visual`); 0 when the whole
 * webview/layout viewport resizes (Telegram Android, `resizes-content`).
 */
export function coveredBottomInset(innerHeight: number, visualHeight: number): number {
  return Math.max(0, Math.round(innerHeight - visualHeight));
}

/**
 * How far to scroll the page (px, positive = down) so an element of the given
 * rect is fully inside the visible band. 0 when it is already visible.
 * Minimal movement: no centering, no fixed offsets.
 */
export function revealDelta(
  rect: RectLike,
  visible: { top: number; height: number },
  margin: number = REVEAL_MARGIN_PX
): number {
  const visibleBottom = visible.top + visible.height;
  if (rect.bottom + margin > visibleBottom) {
    // Never scroll so far that the element's top leaves the visible band.
    const down = rect.bottom + margin - visibleBottom;
    const maxDown = rect.top - margin - visible.top;
    return Math.max(0, Math.min(down, maxDown));
  }
  if (rect.top - margin < visible.top) return rect.top - margin - visible.top;
  return 0;
}

export interface RectLike {
  top: number;
  bottom: number;
}
