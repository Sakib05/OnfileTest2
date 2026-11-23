import { describe, expect, it } from "vitest";
import { AVATAR_MAX_EDGE, clampCrop, cropRect, initialCrop, MAX_ZOOM, MIN_ZOOM, outputEdge, panBy, zoomAt } from "./cropMath";

const SIZES: Array<[number, number]> = [[1200, 800], [800, 1200], [1000, 1000], [4000, 300], [300, 4000], [64, 48]];

describe("cropRect — default (initial centre crop)", () => {
  it("is a centred square of the short side", () => {
    expect(cropRect(initialCrop(), 1200, 800)).toEqual({ sx: 200, sy: 0, side: 800 });
    expect(cropRect(initialCrop(), 800, 1200)).toEqual({ sx: 0, sy: 200, side: 800 });
    expect(cropRect(initialCrop(), 1000, 1000)).toEqual({ sx: 0, sy: 0, side: 1000 });
  });
});

describe("clamping — the crop never exposes empty area", () => {
  it.each(SIZES)("any pan/zoom stays inside the image (%i×%i)", (iw, ih) => {
    for (const zoom of [0.2, 1, 1.7, 4, 9]) {
      for (const n of [-10, -0.4, 0, 0.4, 10]) {
        const r = cropRect({ zoom, nx: n, ny: -n }, iw, ih);
        expect(r.side).toBeGreaterThan(0);
        expect(r.sx).toBeGreaterThanOrEqual(0);
        expect(r.sy).toBeGreaterThanOrEqual(0);
        expect(r.sx + r.side).toBeLessThanOrEqual(iw + 1e-9);
        expect(r.sy + r.side).toBeLessThanOrEqual(ih + 1e-9);
      }
    }
  });
  it("clamps zoom to [MIN, MAX] and ignores NaN", () => {
    expect(clampCrop({ zoom: 0, nx: 0, ny: 0 }, 100, 100).zoom).toBe(MIN_ZOOM);
    expect(clampCrop({ zoom: 99, nx: 0, ny: 0 }, 100, 100).zoom).toBe(MAX_ZOOM);
    expect(clampCrop({ zoom: NaN, nx: NaN, ny: NaN }, 100, 100)).toEqual({ zoom: MIN_ZOOM, nx: 0, ny: 0 });
  });
  it("a square image at zoom 1 cannot be dragged at all; a landscape one only sideways", () => {
    expect(panBy(initialCrop(), 0.5, 0.5, 1000, 1000)).toEqual(initialCrop());
    const p = panBy(initialCrop(), 5, 5, 1200, 800);
    expect(p.ny).toBe(0);
    expect(p.nx).toBeCloseTo(0.25); // (1200/800 − 1)/2
  });
});

describe("dragging", () => {
  it("dragging the photo right reveals more of its LEFT side", () => {
    const before = cropRect(initialCrop(), 1200, 800);
    const after = cropRect(panBy(initialCrop(), 0.1, 0, 1200, 800), 1200, 800);
    expect(after.sx).toBeLessThan(before.sx);
    expect(after.sx).toBeCloseTo(200 - 0.1 * 800);
  });
  it("dragging down reveals the TOP of a portrait photo", () => {
    const s = zoomAt(initialCrop(), 2, 0, 0, 800, 1200);
    const moved = cropRect(panBy(s, 0, 0.2, 800, 1200), 800, 1200);
    expect(moved.sy).toBeLessThan(cropRect(s, 800, 1200).sy);
  });
});

describe("zoom", () => {
  it("zooming in halves the source side at 2×", () => {
    expect(cropRect(zoomAt(initialCrop(), 2, 0, 0, 1000, 1000), 1000, 1000).side).toBe(500);
  });
  it("keeps the point under the focus fixed (pinch/wheel around the fingers)", () => {
    const iw = 2000, ih = 2000;
    const s0 = { zoom: 1.5, nx: 0.1, ny: -0.05 };
    const f = { x: 0.2, y: 0.15 }; // fraction of the box, from its centre
    const imagePointUnder = (s: typeof s0) => {
      const r = cropRect(s, iw, ih);
      return { x: r.sx + (f.x + 0.5) * r.side, y: r.sy + (f.y + 0.5) * r.side };
    };
    const before = imagePointUnder(s0);
    const after = imagePointUnder(zoomAt(s0, 2.4, f.x, f.y, iw, ih));
    expect(after.x).toBeCloseTo(before.x, 5);
    expect(after.y).toBeCloseTo(before.y, 5);
  });
  it("zoom out back to MIN re-centres into a fully covering crop", () => {
    const s = zoomAt(panBy(zoomAt(initialCrop(), 3, 0, 0, 1200, 800), 0.4, 0.3, 1200, 800), 1, 0.3, 0.3, 1200, 800);
    const r = cropRect(s, 1200, 800);
    expect(r.side).toBe(800);
    expect(r.sy).toBe(0);
  });
});

describe("output size", () => {
  it("is capped at 512 and never enlarged", () => {
    expect(outputEdge(2000)).toBe(AVATAR_MAX_EDGE);
    expect(outputEdge(512)).toBe(512);
    expect(outputEdge(300.7)).toBe(300);
    expect(outputEdge(0)).toBe(1);
  });
});

describe("circular preview alignment", () => {
  it("the circle is the inscribed circle of the exported square, so preview and export share one rectangle", () => {
    // The stage/preview/export all call cropRect(state) with the same state: the visible square IS the exported
    // square; the mask circle (closest-side radial gradient) has diameter == the square's side.
    const s = zoomAt(panBy(initialCrop(), 0.05, 0, 1200, 800), 1.8, 0.1, 0.1, 1200, 800);
    const r = cropRect(s, 1200, 800);
    expect(r.side).toBeCloseTo(800 / 1.8);
    // Exported edge equals min(512, floor(side)) and the region is square by construction.
    expect(outputEdge(r.side)).toBe(Math.min(512, Math.floor(r.side)));
  });
});
