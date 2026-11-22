// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Faq from "./Faq";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const onPrivacy = vi.fn();

beforeEach(async () => {
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  Element.prototype.scrollIntoView = vi.fn();
  onPrivacy.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<Faq links={[{ label: "Privacy & Security", onClick: onPrivacy }]} />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const input = () => container.querySelector("#faq-search") as HTMLInputElement;
const type = async (value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(input(), value);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const chip = (label: string) => Array.from(container.querySelectorAll("nav button")).find((b) => b.textContent === label) as HTMLButtonElement;
const questions = () => Array.from(container.querySelectorAll("h3 button")).map((b) => b.textContent ?? "");

describe("Faq help center", () => {
  it("shows all categories as navigation and groups questions under category headings", () => {
    expect(chip("All topics").getAttribute("aria-pressed")).toBe("true");
    for (const label of ["Getting Started", "Channel Connection", "Withdrawals", "Privacy & Security", "Troubleshooting"]) {
      expect(chip(label), label).toBeTruthy();
    }
    expect(container.querySelectorAll("h2").length).toBeGreaterThan(10);
    expect(questions().length).toBeGreaterThan(40);
  });

  it("expands and collapses an answer (aria-expanded) and shows steps", async () => {
    const first = container.querySelector("h3 button") as HTMLButtonElement;
    expect(first.getAttribute("aria-expanded")).toBe("false");
    await act(async () => first.click());
    expect(first.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector(`#${first.getAttribute("aria-controls")}`)).toBeTruthy();
    await act(async () => first.click());
    expect(first.getAttribute("aria-expanded")).toBe("false");
  });

  it("filters by category", async () => {
    await act(async () => chip("Withdrawals").click());
    expect(chip("Withdrawals").getAttribute("aria-pressed")).toBe("true");
    const qs = questions();
    expect(qs.length).toBeGreaterThan(3);
    expect(qs).toContain("What is the minimum withdrawal?");
    expect(qs).not.toContain("What is Onfile?");
  });

  it("searches, shows a result count, and opens the answer stating the $10 minimum", async () => {
    await type("minimum withdrawal");
    expect(container.querySelector('[data-testid="faq-result-count"]')?.textContent).toMatch(/result/);
    expect(questions()[0]).toBe("What is the minimum withdrawal?");
    await act(async () => (container.querySelector("h3 button") as HTMLButtonElement).click());
    expect(container.textContent).toContain("$10 USD");
  });

  it("shows an empty state for no match and can clear the search", async () => {
    await type("zzzzqqqq");
    expect(container.querySelector('[data-testid="faq-empty"]')).toBeTruthy();
    expect(questions()).toHaveLength(0);
    await act(async () => (Array.from(container.querySelectorAll('[data-testid="faq-empty"] button'))[0] as HTMLButtonElement).click());
    expect(container.querySelector('[data-testid="faq-empty"]')).toBeNull();
    expect(questions().length).toBeGreaterThan(40);
  });

  it("clears the search with the clear button", async () => {
    await type("qr");
    await act(async () => (container.querySelector('button[aria-label="Clear search"]') as HTMLButtonElement).click());
    expect(input().value).toBe("");
  });

  it("offers shortcuts to the legal pages", async () => {
    const link = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Privacy & Security" && !b.closest("nav")) as HTMLButtonElement;
    await act(async () => link.click());
    expect(onPrivacy).toHaveBeenCalledOnce();
  });

  it("has no in-page back control (Telegram's native Back Button is the only one)", () => {
    expect(container.querySelector('[aria-label="Back"]')).toBeNull();
  });
});
