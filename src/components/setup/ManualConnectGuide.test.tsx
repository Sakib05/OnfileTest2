// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ManualConnectGuide from "./ManualConnectGuide";
import BotConnectInstructions from "./BotConnectInstructions";
import ChannelConnectScreen from "./ChannelConnectScreen";
import { nativeBackDepth } from "@/lib/telegramBackButton";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * "View step by step guide" navigation. Three separate controls:
 *   bottom Back  → previous guide step
 *   bottom Next  → next guide step
 *   Telegram native Back Button → exit the WHOLE guide (previous app page)
 */

let container: HTMLDivElement;
let root: Root;
let btn: ReturnType<typeof installBackButton>["btn"];
let listeners: Set<() => void>;
let press: () => void;

function installBackButton() {
  const set = new Set<() => void>();
  const b = {
    isVisible: false,
    show: vi.fn(() => {
      b.isVisible = true;
    }),
    hide: vi.fn(() => {
      b.isVisible = false;
    }),
    onClick: vi.fn((cb: () => void) => void set.add(cb)),
    offClick: vi.fn((cb: () => void) => void set.delete(cb)),
  };
  (window as unknown as { Telegram: unknown }).Telegram = {
    WebApp: { initData: "query_id=abc&user=%7B%7D&hash=zzz", BackButton: b, isVersionAtLeast: () => false },
  };
  return { btn: b, listeners: set, press: () => [...set].forEach((l) => l()) };
}

const text = () => container.textContent ?? "";
const buttonByText = (label: string) =>
  Array.from(container.querySelectorAll("button")).find((b) => (b.textContent ?? "").trim() === label) as HTMLButtonElement | undefined;
const buttonByLabel = (label: string) => container.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement | null;
async function click(el: HTMLElement | null | undefined) {
  expect(el).toBeTruthy();
  await act(async () => {
    el!.click();
  });
}
const next = () => click(buttonByText("Next"));
const back = () => click(buttonByText("Back"));
async function nativeBack() {
  await act(async () => {
    press();
  });
}
async function render(node: React.ReactElement) {
  await act(async () => {
    root.render(node);
  });
}

beforeEach(() => {
  const t = installBackButton();
  btn = t.btn;
  listeners = t.listeners;
  press = t.press;
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ username: "TestOnfileBot" }), { status: 200 })));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  // jsdom has no scrollIntoView
  (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  delete (window as unknown as { Telegram?: unknown }).Telegram;
  expect(nativeBackDepth()).toBe(0);
});

describe("Manual Connect guide — bottom Back / Next are internal step controls", () => {
  it("Next moves to the next guide step and does not leave the guide", async () => {
    const onBack = vi.fn();
    await render(<ManualConnectGuide onBack={onBack} onConnected={() => {}} />);
    expect(text()).toContain("Step 1 of 8");
    await next();
    expect(text()).toContain("Step 2 of 8");
    await next();
    expect(text()).toContain("Step 3 of 8");
    expect(onBack).not.toHaveBeenCalled();
  });

  it("bottom Back moves to the previous guide step and does not leave the guide", async () => {
    const onBack = vi.fn();
    await render(<ManualConnectGuide onBack={onBack} onConnected={() => {}} />);
    await next();
    await next();
    await next();
    expect(text()).toContain("Step 4 of 8");
    await back();
    expect(text()).toContain("Step 3 of 8");
    await back();
    expect(text()).toContain("Step 2 of 8");
    expect(onBack).not.toHaveBeenCalled();
  });

  it("bottom Back on the first step has no previous step: it is disabled and never exits the guide", async () => {
    const onBack = vi.fn();
    await render(<ManualConnectGuide onBack={onBack} onConnected={() => {}} />);
    expect(buttonByText("Back")!.disabled).toBe(true);
    await back();
    expect(text()).toContain("Step 1 of 8");
    expect(onBack).not.toHaveBeenCalled();
  });

  it("Back/Next never rebind, show or hide Telegram's native Back Button", async () => {
    await render(<ManualConnectGuide onBack={() => {}} onConnected={() => {}} />);
    const bound = { onClick: btn.onClick.mock.calls.length, offClick: btn.offClick.mock.calls.length, show: btn.show.mock.calls.length, hide: btn.hide.mock.calls.length };
    await next();
    await next();
    await back();
    await next();
    expect(btn.onClick.mock.calls.length).toBe(bound.onClick);
    expect(btn.offClick.mock.calls.length).toBe(bound.offClick);
    expect(btn.show.mock.calls.length).toBe(bound.show);
    expect(btn.hide.mock.calls.length).toBe(bound.hide);
    expect(listeners.size).toBe(1);
    expect(btn.isVisible).toBe(true);
  });
});

describe("Manual Connect guide — Telegram native Back Button exits the whole guide", () => {
  it("shows the native Back Button with exactly one listener while the guide is open", async () => {
    await render(<ManualConnectGuide onBack={() => {}} onConnected={() => {}} />);
    expect(btn.isVisible).toBe(true);
    expect(listeners.size).toBe(1);
    expect(btn.onClick).toHaveBeenCalledTimes(1);
  });

  it("from the first step it returns to the previous application page", async () => {
    const onBack = vi.fn();
    await render(<ManualConnectGuide onBack={onBack} onConnected={() => {}} />);
    await nativeBack();
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("from a LATER step it exits the entire guide — it does NOT merely go back one step", async () => {
    const onBack = vi.fn();
    await render(<ManualConnectGuide onBack={onBack} onConnected={() => {}} />);
    await next();
    await next();
    await next();
    await next();
    expect(text()).toContain("Step 5 of 8");
    await nativeBack();
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(text()).toContain("Step 5 of 8"); // the guide's own step was not touched
  });

  it("native Back is unaffected by step changes (stays the same single registration) and still exits afterwards", async () => {
    const onBack = vi.fn();
    await render(<ManualConnectGuide onBack={onBack} onConnected={() => {}} />);
    await next();
    await back();
    await next();
    await nativeBack();
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(1);
  });

  it("the in-page header arrow is the non-Telegram equivalent: it also exits the whole guide", async () => {
    const onBack = vi.fn();
    await render(<ManualConnectGuide onBack={onBack} onConnected={() => {}} />);
    await next();
    await next();
    await click(buttonByLabel("Exit guide"));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("unmounting the guide removes the native listener and hides the button (no leaked handlers)", async () => {
    await render(<ManualConnectGuide onBack={() => {}} onConnected={() => {}} />);
    expect(listeners.size).toBe(1);
    await act(async () => root.render(<div />));
    expect(listeners.size).toBe(0);
    expect(btn.isVisible).toBe(false);
  });

  it("re-opening the guide never stacks a second listener", async () => {
    for (let i = 0; i < 3; i++) {
      await render(<ManualConnectGuide onBack={() => {}} onConnected={() => {}} />);
      expect(listeners.size).toBe(1);
      await act(async () => root.render(<div />));
      expect(listeners.size).toBe(0);
    }
  });

  it("uses the latest onBack without re-binding", async () => {
    const first = vi.fn();
    const second = vi.fn();
    await render(<ManualConnectGuide onBack={first} onConnected={() => {}} />);
    await render(<ManualConnectGuide onBack={second} onConnected={() => {}} />);
    await nativeBack();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(btn.onClick).toHaveBeenCalledTimes(1);
  });
});

describe("other nested setup pages and root screens", () => {
  it("Bot connect page: native Back returns to the previous setup screen; hidden again when it closes", async () => {
    const onBack = vi.fn();
    await render(<BotConnectInstructions onBack={onBack} onSuccess={() => {}} />);
    expect(btn.isVisible).toBe(true);
    expect(listeners.size).toBe(1);
    await nativeBack();
    expect(onBack).toHaveBeenCalledTimes(1);
    await act(async () => root.render(<div />));
    expect(btn.isVisible).toBe(false);
    expect(listeners.size).toBe(0);
  });

  it("root setup screen (Channel Connect) does not show or bind the native Back Button", async () => {
    await render(<ChannelConnectScreen onConnectViaBot={() => {}} onManualConnected={() => {}} onOpenGuide={() => {}} />);
    expect(btn.show).not.toHaveBeenCalled();
    expect(btn.onClick).not.toHaveBeenCalled();
    expect(btn.isVisible).toBe(false);
    expect(listeners.size).toBe(0);
  });

  it("navigating root → guide → root keeps exactly one listener only while inside the guide", async () => {
    function Host() {
      const [inGuide, setInGuide] = React.useState(false);
      return inGuide ? (
        <ManualConnectGuide onBack={() => setInGuide(false)} onConnected={() => {}} />
      ) : (
        <ChannelConnectScreen onConnectViaBot={() => {}} onManualConnected={() => {}} onOpenGuide={() => setInGuide(true)} />
      );
    }
    await render(<Host />);
    expect(listeners.size).toBe(0);
    await click(Array.from(container.querySelectorAll("button")).find((b) => (b.textContent ?? "").includes("step-by-step guide")));
    expect(text()).toContain("Manual Connect Guide");
    expect(listeners.size).toBe(1);
    await next();
    await next();
    await nativeBack(); // exits the whole guide even from step 3
    expect(text()).toContain("Connect Your Telegram Channel");
    expect(text()).not.toContain("Manual Connect Guide");
    expect(listeners.size).toBe(0);
    expect(btn.isVisible).toBe(false);
  });
});
