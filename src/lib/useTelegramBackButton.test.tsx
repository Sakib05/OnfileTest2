// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTelegramBackButton } from "@/lib/useTelegramBackButton";
import { nativeBackDepth } from "@/lib/telegramBackButton";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Behaviour used by nested pages such as the Profile sub-pages (enabled only while a sub-page is open). */

let container: HTMLDivElement;
let root: Root;
const listeners = new Set<() => void>();
let hidden = true;

beforeEach(() => {
  listeners.clear();
  hidden = true;
  (window as unknown as { Telegram: unknown }).Telegram = {
    WebApp: {
      initData: "x",
      BackButton: {
        show: () => (hidden = false),
        hide: () => (hidden = true),
        onClick: (cb: () => void) => listeners.add(cb),
        offClick: (cb: () => void) => listeners.delete(cb),
      },
    },
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  delete (window as unknown as { Telegram?: unknown }).Telegram;
  expect(nativeBackDepth()).toBe(0);
});

function ProfileLike() {
  const [sub, setSub] = React.useState<null | "faq">(null);
  useTelegramBackButton(() => setSub(null), sub !== null);
  return (
    <div>
      <span data-testid="page">{sub ?? "root"}</span>
      <button id="open" onClick={() => setSub("faq")}>open</button>
    </div>
  );
}
const page = () => container.querySelector("[data-testid=page]")!.textContent;
const press = () => act(async () => [...listeners].forEach((l) => l()));

describe("useTelegramBackButton on nested pages", () => {
  it("hidden on the root page, shown on a sub-page, native Back returns to the previous page, hidden again", async () => {
    await act(async () => root.render(<ProfileLike />));
    expect(page()).toBe("root");
    expect(hidden).toBe(true);
    expect(listeners.size).toBe(0);

    await act(async () => (container.querySelector("#open") as HTMLButtonElement).click());
    expect(page()).toBe("faq");
    expect(hidden).toBe(false);
    expect(listeners.size).toBe(1);

    await press();
    expect(page()).toBe("root");
    expect(hidden).toBe(true);
    expect(listeners.size).toBe(0);
  });

  it("two nested pages mounted at once never produce duplicate handlers; only the top one reacts", async () => {
    const outer = vi.fn();
    const inner = vi.fn();
    function Outer() {
      useTelegramBackButton(outer);
      return <Inner />;
    }
    function Inner() {
      useTelegramBackButton(inner);
      return null;
    }
    await act(async () => root.render(<Outer />));
    expect(listeners.size).toBe(1);
    await press();
    // Effects run child-first, so the OUTER registration is topmost; exactly one handler fires.
    expect(outer.mock.calls.length + inner.mock.calls.length).toBe(1);
  });

  it("enabled=false registers nothing", async () => {
    function Page() {
      useTelegramBackButton(() => {}, false);
      return null;
    }
    await act(async () => root.render(<Page />));
    expect(listeners.size).toBe(0);
    expect(hidden).toBe(true);
  });
});
