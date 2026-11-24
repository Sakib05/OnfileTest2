// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ForceJoinGate from "./ForceJoinGate";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const onPassed = vi.fn();
const onClose = vi.fn();
const gate = { gated: true, state: "join_required" as const, channelTitle: "Pub Chan", channelUsername: "pubchan", joinUrl: "https://t.me/pubchan" };
const respondWith = (state: string) =>
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ gated: true, state, channelTitle: "Pub Chan", joinUrl: gate.joinUrl }), { status: 200 })));
const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLButtonElement | null;

beforeEach(() => {
  onPassed.mockClear();
  onClose.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});
const render = (g = gate) => act(async () => root.render(<ForceJoinGate slug="abc" gate={g} onPassed={onPassed} onClose={onClose} />));

describe("ForceJoinGate", () => {
  it("names the channel and offers Join + 'I've joined'", async () => {
    await render();
    expect(document.body.textContent).toContain("Pub Chan");
    expect(q("gate-join")).toBeTruthy();
    expect(q("gate-verify")).toBeTruthy();
  });

  it("tapping Join opens the channel but NEVER unlocks or calls the server", async () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await render();
    await act(async () => q("gate-join")!.click());
    expect(open).toHaveBeenCalledWith("https://t.me/pubchan", "_blank", "noopener,noreferrer");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(onPassed).not.toHaveBeenCalled();
  });

  it("only a server answer of 'passed' continues; 'join_required' keeps the gate and says so", async () => {
    respondWith("join_required");
    await render();
    await act(async () => q("gate-verify")!.click());
    expect(onPassed).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("can't see you in the channel yet");
    respondWith("passed");
    await act(async () => q("gate-verify")!.click());
    expect(onPassed).toHaveBeenCalledTimes(1);
  });

  it("an unavailable Telegram check does not unlock", async () => {
    respondWith("unavailable");
    await render();
    await act(async () => q("gate-verify")!.click());
    expect(onPassed).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("couldn't confirm your membership");
  });

  it("outside Telegram (no session) there is no Join/verify path, only an explanation", async () => {
    await render({ ...gate, state: "login_required" as never });
    expect(q("gate-join")).toBeNull();
    expect(document.body.textContent).toContain("Open it inside Telegram");
  });

  it("never opens a non-Telegram join URL", async () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);
    await render({ ...gate, joinUrl: "https://evil.example/x" });
    await act(async () => q("gate-join")!.click());
    expect(open).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("join link isn't available");
  });
});
