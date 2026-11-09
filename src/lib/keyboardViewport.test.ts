import { describe, expect, it } from "vitest";
import { coveredBottomInset, isKeyboardOpen, KEYBOARD_MIN_SHRINK_PX, revealDelta } from "./keyboardViewport";

describe("isKeyboardOpen", () => {
  const base = { baselineHeight: 800, viewportHeight: 500, editableFocused: true, coarsePointer: true };

  it("detects a keyboard when a field is focused and the visible viewport shrank a lot", () => {
    expect(isKeyboardOpen(base)).toBe(true);
  });
  it("ignores small viewport changes (URL bar / toolbar)", () => {
    expect(isKeyboardOpen({ ...base, viewportHeight: 800 - (KEYBOARD_MIN_SHRINK_PX - 1) })).toBe(false);
  });
  it("is closed when nothing editable is focused", () => {
    expect(isKeyboardOpen({ ...base, editableFocused: false })).toBe(false);
  });
  it("ignores desktop window resizes (non-touch pointer)", () => {
    expect(isKeyboardOpen({ ...base, coarsePointer: false })).toBe(false);
  });
  it("is closed again once the viewport is restored", () => {
    expect(isKeyboardOpen({ ...base, viewportHeight: 800 })).toBe(false);
  });
});

describe("coveredBottomInset", () => {
  it("is the covered area when only the visual viewport shrinks", () => {
    expect(coveredBottomInset(800, 480)).toBe(320);
  });
  it("is 0 when the layout viewport itself was resized", () => {
    expect(coveredBottomInset(480, 480)).toBe(0);
  });
  it("never goes negative", () => {
    expect(coveredBottomInset(700, 800)).toBe(0);
  });
});

describe("revealDelta", () => {
  const visible = { top: 0, height: 500 };

  it("is 0 when the field is fully visible with margin", () => {
    expect(revealDelta({ top: 100, bottom: 150 }, visible)).toBe(0);
  });
  it("scrolls down by the minimal amount when the field is under the keyboard", () => {
    expect(revealDelta({ top: 560, bottom: 610 }, visible, 16)).toBe(610 + 16 - 500);
  });
  it("scrolls up when the field is above the visible band", () => {
    expect(revealDelta({ top: -40, bottom: 10 }, visible, 16)).toBe(-56);
  });
  it("respects a panned visual viewport (offsetTop)", () => {
    expect(revealDelta({ top: 300, bottom: 350 }, { top: 400, height: 300 }, 16)).toBe(300 - 16 - 400);
  });
  it("never scrolls the field's top out of view when the band is tiny", () => {
    const d = revealDelta({ top: 90, bottom: 400 }, { top: 0, height: 200 }, 16);
    expect(d).toBe(90 - 16);
  });
});
