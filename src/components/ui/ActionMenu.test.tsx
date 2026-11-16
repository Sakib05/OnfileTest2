// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Pencil, Trash2 } from "lucide-react";
import ActionMenu from "./ActionMenu";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const onEdit = vi.fn();
const onDelete = vi.fn();
const btn = () => container.querySelector('[data-testid="action-menu-button"]') as HTMLButtonElement;
const menu = () => container.querySelector('[role="menu"]') as HTMLElement | null;
const items = () => Array.from(container.querySelectorAll('[role="menuitem"]')) as HTMLButtonElement[];
const key = (el: Element, k: string) => act(async () => { el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })); });

beforeEach(async () => {
  onEdit.mockReset();
  onDelete.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <div>
        <span data-testid="outside">outside</span>
        <ActionMenu label="Playlist actions" items={[
          { key: "edit", label: "Edit", icon: Pencil, onSelect: onEdit },
          { key: "off", label: "Disabled", icon: Pencil, onSelect: vi.fn(), disabled: true },
          { key: "delete", label: "Delete", icon: Trash2, onSelect: onDelete, destructive: true },
        ]} />
      </div>
    )
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("ActionMenu", () => {
  it("exposes menu-button semantics and toggles on click", async () => {
    expect(btn().getAttribute("aria-label")).toBe("Playlist actions");
    expect(btn().getAttribute("aria-haspopup")).toBe("menu");
    expect(btn().getAttribute("aria-expanded")).toBe("false");
    expect(menu()).toBeNull();
    await act(async () => btn().click());
    expect(menu()).not.toBeNull();
    expect(btn().getAttribute("aria-expanded")).toBe("true");
    expect(btn().getAttribute("aria-controls")).toBe(menu()!.id);
    await act(async () => btn().click());
    expect(menu()).toBeNull();
  });

  it("focuses the first enabled item on open and moves with Arrow/Home/End, skipping disabled items and wrapping", async () => {
    await act(async () => btn().click());
    expect(document.activeElement).toBe(items()[0]);
    await key(menu()!, "ArrowDown");
    expect(document.activeElement).toBe(items()[2]); // skipped the disabled one
    await key(menu()!, "ArrowDown");
    expect(document.activeElement).toBe(items()[0]); // wraps
    await key(menu()!, "End");
    expect(document.activeElement).toBe(items()[2]);
    await key(menu()!, "Home");
    expect(document.activeElement).toBe(items()[0]);
    await key(menu()!, "ArrowUp");
    expect(document.activeElement).toBe(items()[2]);
  });

  it("ArrowUp on the closed button opens the menu on the last item", async () => {
    await key(btn(), "ArrowUp");
    expect(menu()).not.toBeNull();
    expect(document.activeElement).toBe(items()[2]);
  });

  it("Escape closes and returns focus to the button; Tab closes", async () => {
    await act(async () => btn().click());
    await key(menu()!, "Escape");
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(btn());
    await act(async () => btn().click());
    await key(menu()!, "Tab");
    expect(menu()).toBeNull();
  });

  it("closes when tapping outside but not when pressing inside the menu", async () => {
    await act(async () => btn().click());
    await act(async () => { menu()!.dispatchEvent(new Event("pointerdown", { bubbles: true })); });
    expect(menu()).not.toBeNull();
    await act(async () => { container.querySelector('[data-testid="outside"]')!.dispatchEvent(new Event("pointerdown", { bubbles: true })); });
    expect(menu()).toBeNull();
  });

  it("selecting an item closes the menu and runs that action once; disabled items do nothing", async () => {
    await act(async () => btn().click());
    await act(async () => items()[2].click());
    expect(menu()).toBeNull();
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onEdit).not.toHaveBeenCalled();
    await act(async () => btn().click());
    expect(items()[1].disabled).toBe(true);
  });

  it("marks destructive items in red, separated from the rest, and every item has an icon", async () => {
    await act(async () => btn().click());
    expect(items()[2].className).toContain("text-red-500");
    expect(items()[0].className).not.toContain("text-red-500");
    expect(menu()!.querySelector('[role="separator"]')).not.toBeNull();
    expect(items().every((i) => i.querySelector("svg[aria-hidden='true']"))).toBe(true);
  });

  it("is anchored to the right edge, width-capped to the viewport, and flips upward when there's no room below", async () => {
    const orig = window.innerHeight;
    Object.defineProperty(window, "innerHeight", { value: 600, configurable: true });
    const rectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ top: 560, bottom: 600, left: 0, right: 0, width: 0, height: 40, x: 0, y: 560, toJSON: () => ({}) });
    const heightSpy = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(180);
    await act(async () => btn().click());
    expect(menu()!.className).toContain("right-0");
    expect(menu()!.className).toContain("max-w-[calc(100vw-2rem)]");
    expect(menu()!.className).toContain("bottom-full");
    rectSpy.mockRestore();
    heightSpy.mockRestore();
    Object.defineProperty(window, "innerHeight", { value: orig, configurable: true });
  });

  it("can be disabled", async () => {
    await act(async () => root.render(<ActionMenu items={[]} disabled />));
    expect(btn().disabled).toBe(true);
  });
});
