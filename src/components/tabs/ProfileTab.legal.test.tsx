// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProfileTab from "./ProfileTab";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  Element.prototype.scrollIntoView = vi.fn();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<ProfileTab />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const row = (label: string) =>
  Array.from(container.querySelectorAll("span")).find((s) => s.textContent === label)?.closest("div[class*='cursor-pointer']") as HTMLElement | undefined;
const click = (el: Element | undefined | null) => act(async () => (el as HTMLElement).click());
const h1 = () => container.querySelector("h1")?.textContent;
const button = (label: string) => // skip the FAQ category chips (inside <nav>): we want the bottom shortcut
  Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes(label) && !b.closest("nav")) as HTMLButtonElement;

describe("Me › legal & help navigation", () => {
  it("lists FAQ & Help, Privacy & Security and Terms & Conditions in the Me section", () => {
    expect(row("FAQ & Help")).toBeTruthy();
    expect(row("Privacy & Security")).toBeTruthy();
    expect(row("Terms & Conditions")).toBeTruthy();
  });

  it("opens each page from Me", async () => {
    await click(row("Privacy & Security"));
    expect(h1()).toBe("Privacy & Security");
    expect(container.textContent).toContain("Draft — legal details not yet configured");
  });

  it("opens Terms & Conditions and shows the $10 USD minimum", async () => {
    await click(row("Terms & Conditions"));
    expect(h1()).toBe("Terms & Conditions");
    expect(container.textContent).toContain("$10 USD");
  });

  it("opens the FAQ and cross-navigates FAQ → Privacy → Terms → FAQ", async () => {
    await click(row("FAQ & Help"));
    expect(h1()).toBe("FAQ & Help");
    await click(button("Privacy & Security"));
    expect(h1()).toBe("Privacy & Security");
    await click(button("Terms & Conditions"));
    expect(h1()).toBe("Terms & Conditions");
    await click(button("FAQ & Help"));
    expect(h1()).toBe("FAQ & Help");
  });
});
