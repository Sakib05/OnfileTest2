import { describe, expect, it } from "vitest";
import { maxLevel, uploadsBlocked, usageLevel, usagePercent } from "./usage";

const t = { warn: 70, high: 80, block: 90 };
describe("usage levels", () => {
  it("maps percentages to levels at the configured thresholds", () => {
    expect(usageLevel(69.9, t)).toBe("ok");
    expect(usageLevel(70, t)).toBe("warning");
    expect(usageLevel(80, t)).toBe("high");
    expect(usageLevel(90, t)).toBe("restricted");
    expect(usageLevel(100, t)).toBe("full");
    expect(usageLevel(null, t)).toBe("ok");
  });
  it("blocks new uploads from 90% only", () => {
    expect(uploadsBlocked("high")).toBe(false);
    expect(uploadsBlocked("restricted")).toBe(true);
    expect(uploadsBlocked("full")).toBe(true);
  });
  it("computes percent safely", () => {
    expect(usagePercent(5, 20)).toBe(25);
    expect(usagePercent(1, 0)).toBeNull();
    expect(usagePercent(-1, 10)).toBeNull();
  });
  it("takes the worst level across metrics", () => {
    expect(maxLevel(["ok", "high", "warning"])).toBe("high");
    expect(maxLevel([])).toBe("ok");
  });
});
