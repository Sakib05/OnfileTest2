// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import CreatorRow from "./CreatorRow";

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
const render = (creator: React.ComponentProps<typeof CreatorRow>["creator"]) => act(async () => root.render(<CreatorRow creator={creator} />));

// Used by the shared-file viewer AND the shared-playlist viewer (both render <CreatorRow/>).
describe("CreatorRow avatar (shared file / playlist creator rows)", () => {
  it("shows the creator's Telegram photo and name; a custom picture URL is ignored while the feature is disabled", async () => {
    await render({ firstName: "Sakib", username: "sk", avatarUrl: TG, customAvatarUrl: "https://cdn.example.com/b/avatar-1-x.webp" });
    expect(container.querySelector("img")?.getAttribute("src")).toBe(TG);
    expect(container.textContent).toContain("Sakib");
  });

  it("falls back to the initials avatar when the Telegram photo is missing or fails to load", async () => {
    await render({ firstName: "Sakib", username: null, avatarUrl: null });
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector('[role="img"]')?.textContent).toBe("S");

    await render({ firstName: "Sakib", username: null, avatarUrl: TG });
    await act(async () => void container.querySelector("img")!.dispatchEvent(new Event("error")));
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector('[role="img"]')?.textContent).toBe("S");
  });

  it("renders nothing for an unknown creator and never shows the @username", async () => {
    await render(null);
    expect(container.innerHTML).toBe("");
    await render({ firstName: "Sakib", username: "secret_handle", avatarUrl: null });
    expect(container.textContent).not.toContain("secret_handle");
  });
});
