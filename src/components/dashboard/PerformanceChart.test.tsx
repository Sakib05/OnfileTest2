// @vitest-environment jsdom
import fs from "fs";
import path from "path";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import PerformanceChart from "./PerformanceChart";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * jsdom has no layout/CSS cascade, so this verifies the MECHANISM (pointer vs keyboard modality +
 * the stylesheet rules that act on it). Visual confirmation in a real browser / Telegram WebView
 * is a separate manual check.
 */
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const data = [{ label: "Mon", views: 3, downloads: 1, earnings: 0 }, { label: "Tue", views: 5, downloads: 2, earnings: 1 }];
const wrap = () => container.querySelector('[data-testid="performance-chart"]') as HTMLElement;

describe("PerformanceChart focus ring", () => {
  it("flags pointer interaction (mouse, pen, touch) so the focus ring is suppressed, and keyboard use restores it", async () => {
    await act(async () => root.render(<PerformanceChart data={data} />));
    expect(wrap().dataset.input).toBe("keyboard"); // default: nothing suppressed
    for (const type of ["pointerdown", "mousedown", "touchstart"]) {
      wrap().dataset.input = "keyboard";
      await act(async () => { wrap().dispatchEvent(new Event(type, { bubbles: true })); });
      expect(wrap().dataset.input, type).toBe("pointer");
    }
    await act(async () => { wrap().dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true })); });
    expect(wrap().dataset.input).toBe("keyboard");
  });

  it("does not re-render away the modality attribute on parent updates", async () => {
    await act(async () => root.render(<PerformanceChart data={data} />));
    await act(async () => { wrap().dispatchEvent(new Event("pointerdown", { bubbles: true })); });
    await act(async () => root.render(<PerformanceChart data={[...data]} />));
    expect(wrap().dataset.input).toBe("pointer");
  });

  it("the stylesheet removes outline/tap-highlight only for pointer modality (keyboard focus indicators stay)", () => {
    const css = fs.readFileSync(path.resolve(__dirname, "../../app/globals.css"), "utf8");
    expect(css).toMatch(/\.perf-chart\[data-input="pointer"\] \.recharts-surface:focus[\s\S]*?outline:\s*none/);
    expect(css).toMatch(/\.perf-chart \*\s*\{[^}]*-webkit-tap-highlight-color:\s*transparent/);
    // No blanket rule that would strip focus rings from unrelated controls.
    expect(css).not.toMatch(/(^|\n)\s*\*:focus(-visible)?\s*\{[^}]*outline:\s*none/);
    expect(css).not.toMatch(/(^|\n)\s*:focus(-visible)?\s*\{[^}]*outline:\s*none/);
  });
});
