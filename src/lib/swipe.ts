/**
 * Pure gesture maths for swipe-to-reveal rows (the playlist file rows).
 * No DOM, no React — so the thresholds are unit-tested and the component stays thin.
 *
 * Conventions: `offset` is the horizontal translation of the row content in px.
 * 0 = closed, `-width` = fully open (the action panel on the right is revealed).
 */

/** Movement (px) before we decide whether a gesture is horizontal or vertical. */
export const AXIS_SLOP = 8;
/** A horizontal move must beat the vertical one by this factor to count as a swipe. */
export const AXIS_BIAS = 1.2;
/** Flick speed (px/ms) that opens/closes regardless of distance. */
export const FLICK_VELOCITY = 0.45;
/** Fraction of the action width the row must be dragged past to settle open. */
export const OPEN_THRESHOLD = 0.4;
/** Extra px the row may be pulled past fully-open, with resistance. */
export const OVERSCROLL = 20;

export type Axis = "x" | "y" | null;

/**
 * Decides, from the first movement, whether the user is swiping sideways ("x") or scrolling
 * ("y"). Returns null while the finger has not moved far enough to tell. Once decided the
 * caller keeps the result for the rest of the gesture, so a swipe that wobbles vertically
 * stays a swipe and a scroll that wobbles sideways never moves the row.
 */
export function lockAxis(dx: number, dy: number, slop: number = AXIS_SLOP): Axis {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax < slop && ay < slop) return null;
  return ax > ay * AXIS_BIAS ? "x" : "y";
}

/** Clamps a live drag offset into [-(width + overscroll), 0] with rubber-band resistance past `-width`. */
export function clampOffset(raw: number, width: number): number {
  if (raw >= 0) return 0; // never reveal anything on the left
  if (raw >= -width) return raw;
  const extra = -width - raw; // how far past fully-open
  return -width - Math.min(OVERSCROLL, extra * 0.25);
}

/**
 * Where the row settles when the finger lifts.
 * @param velocity px/ms, negative = moving left
 * @returns true → open, false → closed
 */
export function settleOpen(opts: { offset: number; velocity: number; width: number; wasOpen: boolean }): boolean {
  const { offset, velocity, width, wasOpen } = opts;
  if (velocity <= -FLICK_VELOCITY) return true; // quick flick to the left
  if (velocity >= FLICK_VELOCITY) return false; // quick flick to the right
  // `travelled` = px moved away from the rest position the gesture started at.
  // Closed → opens once dragged left past the threshold. Open → a short nudge keeps it open;
  // it closes once pulled back (rightwards) past the same threshold.
  if (wasOpen) return width + offset < width * OPEN_THRESHOLD;
  return -offset >= width * OPEN_THRESHOLD;
}
