// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui/Toast";
import { AppProvider } from "@/contexts/AppContext";
import WalletTab from "./WalletTab";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** jsdom test of the withdrawal UI's $10 minimum messaging (mocked fetch; the server rule is tested in withdraw.e2e.test.ts). */

let container: HTMLDivElement;
let root: Root;
let calls: { url: string; method: string; body?: string }[];
let balance = "50";

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const qa = (sel: string) => Array.from(document.querySelectorAll(sel));
const btn = (text: string) => qa("button").find((b) => b.textContent?.includes(text)) as HTMLButtonElement | undefined;
const setValue = (el: HTMLInputElement, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });

async function mount() {
  await act(async () => root.render(<AppProvider><ToastProvider><WalletTab /></ToastProvider></AppProvider>));
  await flush();
  await flush();
}

beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method ?? "GET", body: init?.body as string | undefined });
      if (url.startsWith("/api/user/me")) return json({ user: { id: 1, balance, pendingBalance: "0", referralEarnings: "0", totalEarnings: "0", totalDownloads: 0 } });
      if (url.startsWith("/api/channels")) return json({ channels: [{ id: 1, status: "verified" }] });
      if (url.startsWith("/api/wallet/withdraw")) return json({ error: "Minimum withdrawal amount is $10." }, 400);
      if (url.startsWith("/api/wallet")) return json({ transactions: [], withdrawals: [] });
      return json({}, 404);
    })
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("Wallet — $10 minimum withdrawal", () => {
  it("states the minimum on the balance card and in the withdrawal form", async () => {
    balance = "50";
    await mount();
    expect(container.textContent).toContain("Minimum withdrawal: $10 USD");
    await act(async () => btn("Withdraw Now")!.click());
    expect(document.body.textContent).toContain("Minimum withdrawal: $10 USD (10 USDT)");
    expect(document.body.textContent).not.toContain("1 USDT");
  });

  it("explains and blocks a balance under $10 (submit disabled)", async () => {
    balance = "9.99";
    await mount();
    expect(container.textContent).toContain("You need at least $10 available to withdraw.");
    await act(async () => btn("Withdraw Now")!.click());
    expect(document.body.textContent).toContain("Minimum withdrawal amount is $10.");
    expect(btn("Submit Request")!.disabled).toBe(true);
  });

  it("shows the minimum message for a requested amount below $10 and sends no request", async () => {
    balance = "50";
    await mount();
    await act(async () => btn("Withdraw Now")!.click());
    await setValue(document.querySelector('input[type="number"]') as HTMLInputElement, "9.99");
    await setValue(document.querySelector('input[placeholder="Enter your wallet address..."]') as HTMLInputElement, "TXyz1234567890abcdef");
    await act(async () => btn("Submit Request")!.click());
    expect(document.body.textContent).toContain("Minimum withdrawal amount is $10.");
    expect(calls.some((c) => c.url.startsWith("/api/wallet/withdraw"))).toBe(false);
  });

  it("sends $10.00 to the server (which makes the final decision)", async () => {
    balance = "50";
    await mount();
    await act(async () => btn("Withdraw Now")!.click());
    await setValue(document.querySelector('input[type="number"]') as HTMLInputElement, "10");
    await setValue(document.querySelector('input[placeholder="Enter your wallet address..."]') as HTMLInputElement, "TXyz1234567890abcdef");
    await act(async () => btn("Submit Request")!.click());
    await flush();
    const call = calls.find((c) => c.url.startsWith("/api/wallet/withdraw"))!;
    expect(call.method).toBe("POST");
    expect(JSON.parse(call.body!).amount).toBe("10");
  });
});
