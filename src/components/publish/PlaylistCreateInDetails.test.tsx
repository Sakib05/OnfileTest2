// @vitest-environment jsdom
import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui/Toast";
import DetailsStep from "./DetailsStep";
import { EMPTY_DRAFT, type PublishDraft } from "./draft";
import type { PlaylistOption } from "./PlaylistPicker";

// Regression test for the playlist-creation bug: the "New playlist" dialog (a
// <form>) is rendered by a component that lives INSIDE the Post Details <form>.
// Submitting/closing it used to also submit the outer form (nested-form submit
// bubbling), which advanced the wizard and lost the creation feedback.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const onContinue = vi.fn();
const onCreated = vi.fn();
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

function Harness() {
  const [draft, setDraft] = useState<PublishDraft>({ ...EMPTY_DRAFT, title: "A perfectly valid title" });
  const [playlists, setPlaylists] = useState<PlaylistOption[]>([]);
  return (
    <ToastProvider>
      <DetailsStep
        draft={draft}
        onChange={(p) => setDraft((d) => ({ ...d, ...p }))}
        playlists={playlists}
        onPlaylistCreated={(pl) => {
          onCreated(pl);
          setPlaylists((prev) => [pl, ...prev]);
        }}
        onBack={() => undefined}
        onContinue={onContinue}
      />
    </ToastProvider>
  );
}

const byText = (text: string) =>
  Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined;

function typeInto(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(async () => {
  onContinue.mockReset();
  onCreated.mockReset();
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

describe("Create playlist from the Post Details step", () => {
  it("renders the dialog outside the details <form>", async () => {
    await act(async () => byText("New")!.click());
    const dialogForm = document.getElementById("pl-title")!.closest("form")!;
    const detailsForm = container.querySelector("form")!;
    expect(detailsForm.contains(dialogForm)).toBe(false);
  });

  it("creates the playlist, selects it, and does NOT advance the wizard", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ playlist: { id: 5, title: "My Course", totalFiles: 0 }, duplicate: false }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => byText("New")!.click());
    await act(async () => typeInto(document.getElementById("pl-title") as HTMLInputElement, "My Course"));
    await act(async () => byText("Create Playlist")!.click());
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/playlists");
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({ title: "My Course" });
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 5 }));
    expect((container.querySelector("#playlist") as HTMLSelectElement).value).toBe("5");
    expect(document.getElementById("pl-title")).toBeNull(); // dialog closed
    expect(onContinue).not.toHaveBeenCalled(); // the wizard stayed on Details
  });

  it("ignores repeated taps while the request is in flight (one request only)", async () => {
    let resolve!: (r: Response) => void;
    const fetchMock = vi.fn().mockReturnValue(new Promise<Response>((r) => (resolve = r)));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => byText("New")!.click());
    await act(async () => typeInto(document.getElementById("pl-title") as HTMLInputElement, "Once"));
    const form = document.getElementById("pl-title")!.closest("form")!;
    await act(async () => { form.requestSubmit(); form.requestSubmit(); form.requestSubmit(); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => resolve(new Response(JSON.stringify({ playlist: { id: 9, title: "Once" } }), { status: 201 })));
    await flush();
    expect(onContinue).not.toHaveBeenCalled();
  });

  it("shows the required-title error without calling the API or leaving the step", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => byText("New")!.click());
    await act(async () => byText("Create Playlist")!.click());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Playlist title is required.");
    expect(onContinue).not.toHaveBeenCalled();
  });

  it("shows the server error and keeps the dialog open so the creator can retry", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Connect and verify a private Telegram channel before creating a playlist." }), { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => byText("New")!.click());
    await act(async () => typeInto(document.getElementById("pl-title") as HTMLInputElement, "X"));
    await act(async () => byText("Create Playlist")!.click());
    await flush();
    expect(document.body.textContent).toContain("Connect and verify a private Telegram channel");
    expect(document.getElementById("pl-title")).not.toBeNull();
    expect(onContinue).not.toHaveBeenCalled();
  });

  it("closing the dialog with its X button does not submit the details form", async () => {
    await act(async () => byText("New")!.click());
    await act(async () => (document.querySelector('button[aria-label="Close"]') as HTMLButtonElement).click());
    expect(document.getElementById("pl-title")).toBeNull();
    expect(onContinue).not.toHaveBeenCalled();
  });
});
