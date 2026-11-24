// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import TelegramAvatar from "./TelegramAvatar";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TG = "https://t.me/i/userpic/320/abc.jpg";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const render = (props: React.ComponentProps<typeof TelegramAvatar>) => act(async () => root.render(<TelegramAvatar {...props} />));
const img = () => container.querySelector("img");
const fail = () => act(async () => void img()!.dispatchEvent(new Event("error")));

describe("avatar priority (Telegram photo → initials)", () => {
  it("1) Telegram photo is used when available", async () => {
    await render({ photoUrl: TG, firstName: "Sakib" });
    expect(img()?.getAttribute("src")).toBe(TG);
  });

  it("2) initial-letter avatar when there is no Telegram photo (no <img>, no broken image)", async () => {
    await render({ photoUrl: null, firstName: "sakib" });
    expect(img()).toBeNull();
    expect(container.textContent).toBe("S");
  });

  it("a Telegram photo that fails to load falls back to the initials", async () => {
    await render({ photoUrl: TG, firstName: "Sakib" });
    await fail();
    expect(img()).toBeNull();
    expect(container.textContent).toBe("S");
  });

  it("never renders unsafe URLs (http / javascript:)", async () => {
    await render({ photoUrl: "http://evil.example/a.png", firstName: "Sakib" });
    expect(img()).toBeNull();
    await render({ photoUrl: "javascript:alert(1)", firstName: "Sakib" });
    expect(img()).toBeNull();
  });

  it("ignores a stale custom picture URL (custom upload is disabled for now)", async () => {
    await render({ photoUrl: TG, firstName: "Sakib", ...({ customUrl: "https://cdn.example.com/x.webp" } as object) });
    expect(img()?.getAttribute("src")).toBe(TG);
  });

  it("keeps a fixed size (no layout shift)", async () => {
    await render({ photoUrl: TG, firstName: "Sakib", size: 68 });
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.width).toBe("68px");
    expect(el.style.height).toBe("68px");
  });
});
