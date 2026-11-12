import { describe, expect, it } from "vitest";
import { AXIS_SLOP, clampOffset, lockAxis, OVERSCROLL, settleOpen } from "./swipe";

describe("lockAxis", () => {
  it("waits until the finger has moved past the slop", () => {
    expect(lockAxis(0, 0)).toBeNull();
    expect(lockAxis(AXIS_SLOP - 1, 2)).toBeNull();
  });
  it("a clearly horizontal move is a swipe", () => {
    expect(lockAxis(-20, 3)).toBe("x");
    expect(lockAxis(30, -10)).toBe("x");
  });
  it("a vertical or diagonal-ish move is a scroll (never moves the row)", () => {
    expect(lockAxis(2, 24)).toBe("y");
    expect(lockAxis(-12, 14)).toBe("y");
    expect(lockAxis(-10, -9)).toBe("y"); // 45° → treated as scroll, not swipe
  });
});

describe("clampOffset", () => {
  it("never moves right of closed", () => {
    expect(clampOffset(40, 88)).toBe(0);
    expect(clampOffset(0, 88)).toBe(0);
  });
  it("follows the finger up to fully open", () => {
    expect(clampOffset(-50, 88)).toBe(-50);
    expect(clampOffset(-88, 88)).toBe(-88);
  });
  it("rubber-bands (and caps) past fully open", () => {
    const v = clampOffset(-120, 88);
    expect(v).toBeLessThan(-88);
    expect(v).toBeGreaterThan(-120);
    expect(clampOffset(-1000, 88)).toBe(-88 - OVERSCROLL);
  });
});

describe("settleOpen", () => {
  const W = 88;
  it("closed row: opens only when dragged far enough", () => {
    expect(settleOpen({ offset: -20, velocity: 0, width: W, wasOpen: false })).toBe(false);
    expect(settleOpen({ offset: -40, velocity: -0.1, width: W, wasOpen: false })).toBe(true);
  });
  it("open row: a short nudge stays open, a real pull back closes", () => {
    expect(settleOpen({ offset: -80, velocity: 0, width: W, wasOpen: true })).toBe(true);
    expect(settleOpen({ offset: -40, velocity: 0, width: W, wasOpen: true })).toBe(false);
  });
  it("flicks decide regardless of distance", () => {
    expect(settleOpen({ offset: -10, velocity: -0.8, width: W, wasOpen: false })).toBe(true);
    expect(settleOpen({ offset: -80, velocity: 0.8, width: W, wasOpen: true })).toBe(false);
  });
});
