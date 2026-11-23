// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixture } from "@/test/avatarFixtures";
import type { CropImage } from "@/lib/profile/avatarImage";
import { cropRect, initialCrop, MAX_ZOOM } from "@/lib/profile/cropMath";
import AvatarCropper from "./AvatarCropper";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const IW = 1200;
const IH = 800;
const ctx = { fillStyle: "", fillRect: vi.fn(), drawImage: vi.fn(), imageSmoothingEnabled: false, imageSmoothingQuality: "low" };
let blobFor: (type: string) => Blob | null;

let container: HTMLDivElement;
let root: Root;
const onCancel = vi.fn();
const onApply = vi.fn();
const image = (): CropImage => {
  const canvas = document.createElement("canvas");
  canvas.width = IW;
  canvas.height = IH;
  return { canvas, width: IW, height: IH, originalWidth: 4000, originalHeight: 2667, format: "jpeg", decoder: "test", release: vi.fn() };
};

beforeEach(async () => {
  ctx.fillRect.mockClear();
  ctx.drawImage.mockClear();
  onCancel.mockClear();
  onApply.mockClear();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => ctx) as never);
  HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback, type?: string) {
    cb(blobFor(type ?? "image/png"));
  };
  blobFor = (type) => new Blob([new Uint8Array(fixture(type === "image/jpeg" ? "avatar-512.jpg" : "avatar-512.webp"))], { type });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<AvatarCropper image={image()} onCancel={onCancel} onApply={onApply} />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement;
const btn = (id: string) => q(id) as HTMLButtonElement;

function ptr(type: string, id: number, x: number, y: number) {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
  Object.defineProperty(ev, "pointerId", { value: id });
  return act(async () => void q("crop-stage").dispatchEvent(ev));
}
/** The source rectangle used by the most recent STAGE paint (stage + preview paint every change; stage is first). */
const lastRects = () => {
  const calls = ctx.drawImage.mock.calls;
  const stage = calls.at(-2)!;
  const preview = calls.at(-1)!;
  return { stage: { sx: stage[1], sy: stage[2], side: stage[3] }, preview: { sx: preview[1], sy: preview[2], side: preview[3] }, stageArgs: stage, previewArgs: preview };
};
const click = (id: string) => act(async () => void btn(id).click());

describe("AvatarCropper — layout", () => {
  it("opens as a dialog with the square stage, circular mask, preview and all five controls", () => {
    expect(q("avatar-cropper").getAttribute("role")).toBe("dialog");
    expect(q("crop-stage")).toBeTruthy();
    expect(q("crop-mask").getAttribute("style")).toContain("radial-gradient(circle closest-side");
    expect(q("crop-preview").className).toContain("rounded-full");
    const text = q("avatar-cropper").textContent!;
    for (const label of ["Cancel", "Reset", "Apply Crop"]) expect(text).toContain(label);
    expect(btn("zoom-out").getAttribute("aria-label")).toBe("Zoom out");
    expect(btn("zoom-in").getAttribute("aria-label")).toBe("Zoom in");
    // touch targets ≥ 44 px
    expect(btn("zoom-in").className).toMatch(/h-11 w-11/);
    expect(btn("crop-apply").className).toContain("min-h-12");
  });

  it("the stage is a perfect square (1:1)", () => {
    const style = q("crop-stage").style;
    expect(style.width).toBe(style.height);
  });

  it("starts with the default centre crop and paints stage + preview from the SAME rectangle", () => {
    const { stage, preview } = lastRects();
    expect(stage).toEqual(cropRect(initialCrop(), IW, IH));
    expect(preview).toEqual(stage);
  });
});

describe("AvatarCropper — dragging", () => {
  it("dragging repositions the photo and the preview follows", async () => {
    const before = lastRects().stage;
    await ptr("pointerdown", 1, 100, 100);
    await ptr("pointermove", 1, 160, 100); // drag right
    await ptr("pointerup", 1, 160, 100);
    const { stage, preview } = lastRects();
    expect(stage.sx).toBeLessThan(before.sx); // dragging right reveals more of the left
    expect(stage.sy).toBe(before.sy); // landscape at zoom 1: no vertical room
    expect(stage.side).toBe(before.side);
    expect(preview).toEqual(stage);
  });

  it("cannot be dragged past the photo's edge (no empty area)", async () => {
    await ptr("pointerdown", 1, 0, 0);
    await ptr("pointermove", 1, 5000, 5000);
    const { stage } = lastRects();
    expect(stage.sx).toBe(0);
    expect(stage.sy).toBe(0);
  });

  it("moving a pointer that is not down does nothing", async () => {
    const n = ctx.drawImage.mock.calls.length;
    await ptr("pointermove", 9, 300, 300);
    expect(ctx.drawImage.mock.calls.length).toBe(n);
  });
});

describe("AvatarCropper — zoom", () => {
  it("zoom buttons change the crop size; zoom out is disabled at the minimum", async () => {
    expect(btn("zoom-out").disabled).toBe(true);
    const base = lastRects().stage.side;
    await click("zoom-in");
    const zoomed = lastRects().stage.side;
    expect(zoomed).toBeCloseTo(base / 1.25);
    expect(btn("zoom-out").disabled).toBe(false);
    await click("zoom-out");
    expect(lastRects().stage.side).toBeCloseTo(base);
  });

  it("zoom-in stops at the maximum", async () => {
    for (let i = 0; i < 12; i++) await click("zoom-in");
    expect(lastRects().stage.side).toBeCloseTo(IH / MAX_ZOOM);
    expect(btn("zoom-in").disabled).toBe(true);
  });

  it("the slider zooms too", async () => {
    const slider = q("zoom-slider") as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(slider, "2");
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(lastRects().stage.side).toBeCloseTo(IH / 2);
  });

  it("mouse-wheel zooms in (scroll up) and out (scroll down)", async () => {
    const base = lastRects().stage.side;
    await act(async () => void q("crop-stage").dispatchEvent(new WheelEvent("wheel", { deltaY: -200, bubbles: true, cancelable: true })));
    const inSide = lastRects().stage.side;
    expect(inSide).toBeLessThan(base);
    await act(async () => void q("crop-stage").dispatchEvent(new WheelEvent("wheel", { deltaY: 400, bubbles: true, cancelable: true })));
    expect(lastRects().stage.side).toBeGreaterThan(inSide);
  });

  it("two-finger pinch zooms (spread = in, pinch = out)", async () => {
    const base = lastRects().stage.side;
    await ptr("pointerdown", 1, 120, 140);
    await ptr("pointerdown", 2, 160, 140);
    await ptr("pointermove", 2, 260, 140); // fingers spread: 40 → 140 px
    const spread = lastRects().stage.side;
    expect(spread).toBeLessThan(base);
    await ptr("pointermove", 2, 180, 140); // pinch back
    expect(lastRects().stage.side).toBeGreaterThan(spread);
    await ptr("pointerup", 1, 120, 140);
    await ptr("pointerup", 2, 180, 140);
  });

  it("keyboard: + / − zoom and arrows pan", async () => {
    const key = (k: string) => act(async () => void q("crop-stage").dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })));
    const base = lastRects().stage;
    await key("+");
    expect(lastRects().stage.side).toBeLessThan(base.side);
    await key("ArrowLeft");
    expect(lastRects().stage.sx).not.toBe(base.sx);
  });
});

describe("AvatarCropper — reset / cancel / apply", () => {
  it("Reset restores the default crop and is disabled when already default", async () => {
    expect(btn("crop-reset").disabled).toBe(true);
    const initial = lastRects().stage;
    await click("zoom-in");
    await ptr("pointerdown", 1, 0, 0);
    await ptr("pointermove", 1, 40, 30);
    await ptr("pointerup", 1, 40, 30);
    expect(btn("crop-reset").disabled).toBe(false);
    await click("crop-reset");
    expect(lastRects().stage).toEqual(initial);
  });

  it("Cancel calls onCancel and applies nothing", async () => {
    await click("crop-cancel");
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
  });

  it("Escape cancels", async () => {
    await act(async () => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("Apply Crop exports exactly the previewed region as a valid square file ≤ 512 px — and uploads nothing", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await click("zoom-in");
    await ptr("pointerdown", 1, 100, 100);
    await ptr("pointermove", 1, 140, 100);
    await ptr("pointerup", 1, 140, 100);
    const previewed = lastRects().stage;
    await click("crop-apply");
    expect(onApply).toHaveBeenCalledTimes(1);
    const file = onApply.mock.calls[0][0] as File;
    expect(file).toBeInstanceOf(File);
    expect(file.type).toBe("image/webp");
    expect(file.size).toBeGreaterThan(0);
    // the export painted the same source rectangle that the preview showed, into a square ≤ 512 destination
    const exportCall = ctx.drawImage.mock.calls.at(-1)!;
    expect(exportCall.slice(1, 5)).toEqual([previewed.sx, previewed.sy, previewed.side, previewed.side]);
    expect(exportCall[7]).toBe(exportCall[8]);
    expect(exportCall[7]).toBeLessThanOrEqual(512);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("a failed export shows a specific error, keeps the editor open and allows retry", async () => {
    blobFor = () => null;
    await click("crop-apply");
    expect(onApply).not.toHaveBeenCalled();
    expect(q("crop-error").textContent).toMatch(/couldn't prepare the cropped picture/i);
    expect(q("crop-error").textContent).not.toMatch(/corrupt/i);
    expect(btn("crop-apply").disabled).toBe(false);
    blobFor = (type) => new Blob([new Uint8Array(fixture("avatar-512.webp"))], { type });
    await click("crop-apply");
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(q("crop-error")).toBeNull();
  });

  it("double-tapping Apply exports once", async () => {
    await act(async () => {
      btn("crop-apply").click();
      btn("crop-apply").click();
    });
    expect(onApply).toHaveBeenCalledTimes(1);
  });
});
