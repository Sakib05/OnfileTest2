import { describe, expect, it, vi } from "vitest";
import { readClipboardText } from "./clipboard";

const LINK = "https://t.me/c/1234567890/125";

describe("readClipboardText", () => {
  it("returns a trimmed valid link from the Clipboard API", async () => {
    const r = await readClipboardText({ navigatorRead: async () => `  ${LINK}\n` });
    expect(r).toEqual({ status: "ok", text: LINK });
  });

  it("returns arbitrary/invalid text unchanged (validation happens on Continue, not on paste)", async () => {
    const r = await readClipboardText({ navigatorRead: async () => "hello world" });
    expect(r).toEqual({ status: "ok", text: "hello world" });
  });

  it("reports an empty clipboard", async () => {
    expect(await readClipboardText({ navigatorRead: async () => "" })).toEqual({ status: "empty" });
    expect(await readClipboardText({ navigatorRead: async () => "   \n" })).toEqual({ status: "empty" });
  });

  it("does not consult the Telegram bridge after a successful (empty) Clipboard API read", async () => {
    const telegramRead = vi.fn();
    await readClipboardText({ navigatorRead: async () => "", telegramRead });
    expect(telegramRead).not.toHaveBeenCalled();
  });

  it("reports denied when the Clipboard API rejects and there is no fallback", async () => {
    const r = await readClipboardText({
      navigatorRead: async () => {
        throw new DOMException("denied", "NotAllowedError");
      },
    });
    expect(r).toEqual({ status: "denied" });
  });

  it("falls back to the Telegram bridge when the Clipboard API rejects", async () => {
    const r = await readClipboardText({
      navigatorRead: async () => {
        throw new Error("denied");
      },
      telegramRead: (cb) => cb(LINK),
    });
    expect(r).toEqual({ status: "ok", text: LINK });
  });

  it("uses the Telegram bridge when the Clipboard API is missing", async () => {
    const r = await readClipboardText({ navigatorRead: null, telegramRead: (cb) => cb(` ${LINK} `) });
    expect(r).toEqual({ status: "ok", text: LINK });
  });

  it("treats a null Telegram result as empty, or denied if the Clipboard API had already failed", async () => {
    expect(await readClipboardText({ telegramRead: (cb) => cb(null) })).toEqual({ status: "empty" });
    expect(
      await readClipboardText({
        navigatorRead: async () => {
          throw new Error("denied");
        },
        telegramRead: (cb) => cb(null),
      })
    ).toEqual({ status: "denied" });
  });

  it("reports denied if the Telegram bridge throws", async () => {
    const r = await readClipboardText({
      telegramRead: () => {
        throw new Error("boom");
      },
    });
    expect(r).toEqual({ status: "denied" });
  });

  it("reports unavailable when nothing can read the clipboard", async () => {
    expect(await readClipboardText({})).toEqual({ status: "unavailable" });
  });
});
