// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import TelegramAvatar from "./TelegramAvatar";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CUSTOM = "https://cdn.example.com/tok/bucket/avatar-1-ab.webp";
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

describe("avatar priority", () => {
  it("1) custom picture wins over the Telegram photo", async () => {
    await render({ customUrl: CUSTOM, photoUrl: TG, firstName: "Sakib" });
    expect(img()?.getAttribute("src")).toBe(CUSTOM);
  });

  it("2) Telegram photo is used when there is no custom picture", async () => {
    await render({ customUrl: null, photoUrl: TG, firstName: "Sakib" });
    expect(img()?.getAttribute("src")).toBe(TG);
  });

  it("3) initial-letter avatar when neither exists (no <img>)", async () => {
    await render({ customUrl: null, photoUrl: null, firstName: "sakib" });
    expect(img()).toBeNull();
    expect(container.textContent).toBe("S");
  });

  it("a custom picture that fails to load falls back to the Telegram photo, then to initials", async () => {
    await render({ customUrl: CUSTOM, photoUrl: TG, firstName: "Sakib" });
    await fail();
    expect(img()?.getAttribute("src")).toBe(TG);
    await fail();
    expect(img()).toBeNull();
    expect(container.textContent).toBe("S");
  });

  it("removing the custom picture (prop → null) restores the Telegram photo", async () => {
    await render({ customUrl: CUSTOM, photoUrl: TG, firstName: "Sakib" });
    await render({ customUrl: null, photoUrl: TG, firstName: "Sakib" });
    expect(img()?.getAttribute("src")).toBe(TG);
  });

  it("removing the custom picture with no Telegram photo restores the initials avatar", async () => {
    await render({ customUrl: CUSTOM, photoUrl: null, firstName: "Sakib" });
    await render({ customUrl: null, photoUrl: null, firstName: "Sakib" });
    expect(img()).toBeNull();
    expect(container.textContent).toBe("S");
  });

  it("never renders unsafe custom URLs (http / javascript:)", async () => {
    await render({ customUrl: "http://evil.example/a.png", photoUrl: null, firstName: "Sakib" });
    expect(img()).toBeNull();
    await render({ customUrl: "javascript:alert(1)", photoUrl: TG, firstName: "Sakib" });
    expect(img()?.getAttribute("src")).toBe(TG);
  });

  it("keeps a fixed size (no layout shift)", async () => {
    await render({ customUrl: CUSTOM, photoUrl: TG, firstName: "Sakib", size: 68 });
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.width).toBe("68px");
    expect(el.style.height).toBe("68px");
  });
});
