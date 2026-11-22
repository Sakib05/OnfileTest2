// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/contexts/AppContext", () => ({
  useApp: () => ({ user: { balance: "25.500000", pendingBalance: "0", referralEarnings: "0", totalEarnings: "0" }, refreshUser: async () => {} }),
}));

import WalletTab from "./WalletTab";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
let resolveWithdraw: (r: Response) => void;

beforeEach(async () => {
  fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url === "/api/wallet/withdraw" && init?.method === "POST") {
      return new Promise<Response>((resolve) => (resolveWithdraw = resolve));
    }
    return Promise.resolve(new Response(JSON.stringify({ transactions: [], withdrawals: [] }), { status: 200 }));
  });
  vi.stubGlobal("fetch", fetchMock);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<WalletTab />));
  const open = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Withdraw Now")!;
  await act(async () => open.click());
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const amount = () => document.querySelector("#withdraw-amount") as HTMLInputElement;
const help = () => document.querySelector("#withdraw-amount-help")!.textContent ?? "";
const submit = () => Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Submit Request" || b.textContent === "Submitting...") as HTMLButtonElement;
const setValue = async (el: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const address = () => document.querySelector('input[placeholder="Enter your wallet address..."]') as HTMLInputElement;

describe("Wallet withdrawal form", () => {
  it("shows the $10 USD minimum on the wallet card and in the dialog", () => {
    expect(container.textContent).toContain("Minimum withdrawal: $10 USD");
    expect(document.body.textContent).toContain("Minimum withdrawal: $10 USD (10 USDT)");
  });

  it("blocks amounts below $10 with a helpful message and a disabled submit button", async () => {
    await setValue(address(), "TXyz1234567890abcdef");
    await setValue(amount(), "9.99");
    expect(help()).toContain("Minimum withdrawal is $10 USD");
    expect(amount().getAttribute("aria-invalid")).toBe("true");
    expect(submit().disabled).toBe(true);
  });

  it("allows exactly $10", async () => {
    await setValue(address(), "TXyz1234567890abcdef");
    await setValue(amount(), "10");
    expect(help()).not.toContain("Minimum withdrawal is");
    expect(submit().disabled).toBe(false);
  });

  it("rejects malformed, zero and negative amounts", async () => {
    await setValue(address(), "TXyz1234567890abcdef");
    for (const bad of ["abc", "0", "-10", "1e3", "10,5", "10.1234567"]) {
      await setValue(amount(), bad);
      expect(submit().disabled, bad).toBe(true);
      expect(amount().getAttribute("aria-invalid"), bad).toBe("true");
    }
  });

  it("rejects an amount above the available balance", async () => {
    await setValue(address(), "TXyz1234567890abcdef");
    await setValue(amount(), "25.500001");
    expect(help()).toContain("Insufficient balance");
    expect(submit().disabled).toBe(true);
    await setValue(amount(), "25.5");
    expect(submit().disabled).toBe(false);
  });

  it("needs a wallet address", async () => {
    await setValue(amount(), "10");
    expect(submit().disabled).toBe(true);
  });

  it("sends exactly one request when the form is submitted twice quickly", async () => {
    await setValue(address(), "TXyz1234567890abcdef");
    await setValue(amount(), "12.5");
    const form = document.querySelector("form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    const posts = fetchMock.mock.calls.filter(([u, i]) => u === "/api/wallet/withdraw" && (i as RequestInit)?.method === "POST");
    expect(posts).toHaveLength(1);
    expect(JSON.parse((posts[0][1] as RequestInit).body as string)).toMatchObject({ amount: "12.5", walletAddress: "TXyz1234567890abcdef", network: "TRC20", currency: "USDT" });
    await act(async () => resolveWithdraw(new Response(JSON.stringify({ withdrawal: { id: 1 } }), { status: 201 })));
  });
});
