// @vitest-environment jsdom
import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LinkStep from "./LinkStep";
import { EMPTY_DRAFT, type PublishDraft } from "./draft";

// SIMULATED server: `fetch` is stubbed with the responses /api/publish/verify-link returns.
// These tests prove the UI flow (auto-advance, errors, double-submit guard); they do not prove a
// real Telegram post exists — that is decided server-side (see telegramBot.test.ts / the report).
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const refreshChannels = vi.fn();
vi.mock("@/contexts/AppContext", () => ({ useApp: () => ({ refreshChannels }) }));

let container: HTMLDivElement;
let root: Root;
const onContinue = vi.fn();
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

function Harness() {
  const [draft, setDraft] = useState<PublishDraft>(EMPTY_DRAFT);
  return <LinkStep draft={draft} onChange={(p) => setDraft((d) => ({ ...d, ...p }))} onContinue={onContinue} />;
}

const input = () => document.getElementById("post-link") as HTMLInputElement;
const submitBtn = () => container.querySelector('button[type="submit"]') as HTMLButtonElement;
const alertText = () => container.querySelector('[role="alert"]')?.textContent ?? "";

function typeLink(value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  return act(async () => {
    setter.call(input(), value);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const submit = () => act(async () => { submitBtn().click(); });

const OK = (messageId: number) => ({
  verified: true,
  canonicalLink: `https://t.me/c/4447210820/${messageId}`,
  messageId,
  messageExistenceVerified: true,
  channel: { name: "Test channel", username: null },
});
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

beforeEach(async () => {
  onContinue.mockReset();
  refreshChannels.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<Harness />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("LinkStep — automatic continue after server verification", () => {
  it("a verified link proceeds automatically, with NO 'Connected Channel Verified' screen and no second tap", async () => {
    const fetchMock = vi.fn(async () => json(200, OK(15)));
    vi.stubGlobal("fetch", fetchMock);
    await typeLink("https://t.me/c/4447210820/15");
    await submit();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain("Connected Channel Verified");
    expect(container.textContent).not.toContain("We confirmed the channel matches");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("post #152 (valid format, same channel, does not exist) → error, no advance, link kept for correction", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(404, { error: "Post not found. Please check the Telegram post link and try again.", reason: "post_not_found" })));
    await typeLink("https://t.me/c/4447210820/152");
    await submit();
    await flush();
    expect(onContinue).not.toHaveBeenCalled();
    expect(alertText()).toContain("Post not found. Please check the Telegram post link and try again.");
    expect(input().value).toBe("https://t.me/c/4447210820/152");
    expect(input().disabled).toBe(false);
  });

  it("valid post after correcting an invalid link → accepted and proceeds automatically", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(404, { error: "Post not found. Please check the Telegram post link and try again.", reason: "post_not_found" }))
      .mockResolvedValueOnce(json(200, OK(15)));
    vi.stubGlobal("fetch", fetchMock);
    await typeLink("https://t.me/c/4447210820/152");
    await submit();
    await flush();
    expect(onContinue).not.toHaveBeenCalled();
    await typeLink("https://t.me/c/4447210820/15");
    expect(container.querySelector('[role="alert"]')).toBeNull(); // stale error cleared on edit
    await submit();
    await flush();
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it("another channel's post → mismatch error, no advance", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(403, { error: "This post does not belong to your connected Telegram channel.", reason: "channel_mismatch" })));
    await typeLink("https://t.me/c/1112223334/15");
    await submit();
    await flush();
    expect(onContinue).not.toHaveBeenCalled();
    expect(alertText()).toContain("does not belong to your connected Telegram channel");
  });

  it("invalid Telegram URL → rejected client-side without any request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await typeLink("https://example.com/not-telegram");
    await submit();
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onContinue).not.toHaveBeenCalled();
    expect(alertText()).toContain("isn't a Telegram link");
  });

  it.each([
    [503, "post_verification_unavailable", "We couldn't confirm that this post exists because Telegram didn't answer reliably."],
    [403, "bot_no_access", "Onfile couldn't access this post."],
    [409, "probe_chat_unavailable", "Open the Onfile bot chat in Telegram, press Start"],
  ])("server %i / %s → visible error, never advances", async (status, reason, message) => {
    vi.stubGlobal("fetch", vi.fn(async () => json(status, { error: message, reason })));
    await typeLink("https://t.me/c/4447210820/15");
    await submit();
    await flush();
    expect(onContinue).not.toHaveBeenCalled();
    expect(alertText()).toContain(message);
  });

  it("a network failure shows an error and never advances", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await typeLink("https://t.me/c/4447210820/15");
    await submit();
    await flush();
    expect(onContinue).not.toHaveBeenCalled();
    expect(alertText()).toContain("Network problem");
  });

  it("an aborted (timed-out) request shows an error and never advances", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { const e = new Error("aborted"); e.name = "AbortError"; throw e; }));
    await typeLink("https://t.me/c/4447210820/15");
    await submit();
    await flush();
    expect(onContinue).not.toHaveBeenCalled();
    expect(alertText()).toContain("taking too long");
  });

  it("a 200 response WITHOUT messageExistenceVerified:true is not accepted (fail closed)", async () => {
    const { messageExistenceVerified: _omit, ...legacy } = OK(15);
    void _omit;
    vi.stubGlobal("fetch", vi.fn(async () => json(200, legacy)));
    await typeLink("https://t.me/c/4447210820/15");
    await submit();
    await flush();
    expect(onContinue).not.toHaveBeenCalled();
    expect(alertText()).not.toBe("");
  });

  it("a non-JSON server error shows a generic error and never advances", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>oops</html>", { status: 502 })));
    await typeLink("https://t.me/c/4447210820/15");
    await submit();
    await flush();
    expect(onContinue).not.toHaveBeenCalled();
    expect(alertText()).toContain("couldn't verify this link");
  });

  it("shows a loading indicator and prevents duplicate submissions while verification is running", async () => {
    let release!: (r: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((res) => { release = res; }));
    vi.stubGlobal("fetch", fetchMock);
    await typeLink("https://t.me/c/4447210820/15");
    const form = container.querySelector("form")!;
    await submit();
    expect(submitBtn().disabled).toBe(true);
    expect(submitBtn().textContent).toContain("Verifying");
    expect(input().disabled).toBe(true);
    // repeated submissions (button, Enter / form submit) while pending
    await submit();
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onContinue).not.toHaveBeenCalled(); // not before the server answers
    await act(async () => release(json(200, OK(15))));
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onContinue).toHaveBeenCalledTimes(1);
  });
});
