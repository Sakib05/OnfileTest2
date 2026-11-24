// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ toast: () => {} }) }));
vi.mock("@/lib/useTelegramBackButton", () => ({ useTelegramBackButton: () => {} }));

import AdvertiseSection from "./AdvertiseSection";
import SponsoredSlot from "@/components/ads/SponsoredSlot";
import { buildOverview, serializeCampaign, type CampaignRow } from "@/lib/ads/serialize";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;

const row = (over: Partial<CampaignRow>): CampaignRow =>
  ({
    id: 1, publicId: "AD-AAAAAAAA", userId: 1, status: "draft", adType: "onfile_content", contentKind: "file", objective: "clicks",
    campaignName: "Camp", headline: "Head", description: "Desc", ctaText: "Open", placements: ["library"], targeting: { countries: [], languages: [] },
    budget: "10.00", spent: "0.000000", impressions: 0, clicks: 0, verifiedJoins: 0, currency: "USD", targetAmount: null,
    startDate: new Date("2030-01-01T00:00:00Z"), endDate: new Date("2030-01-08T23:59:59Z"), paymentStatus: "pending_confirmation",
    pausedBy: null, joinVerifiable: false, createdAt: new Date(), ...over,
  }) as CampaignRow;

const rows = [
  row({ publicId: "AD-DRAFTAAA", status: "draft", campaignName: "My draft" }),
  row({ publicId: "AD-PENDINGA", status: "pending", campaignName: "Waiting" }),
  row({ publicId: "AD-ACTIVEAA", status: "active", campaignName: "Live one", impressions: 200, clicks: 10, spent: "2.500000", targetAmount: 100 }),
  row({ publicId: "AD-PAUSEDAA", status: "paused", campaignName: "On hold", pausedBy: "creator" }),
  row({ publicId: "AD-PAUSEDBB", status: "paused", campaignName: "Admin hold", pausedBy: "admin" }),
  row({ publicId: "AD-REJECTAA", status: "rejected", campaignName: "No go", rejectionReason: "Bad headline" }),
];

function respond(url: string): Response {
  if (url === "/api/advertise") {
    return new Response(JSON.stringify({ campaigns: rows.map((r) => serializeCampaign(r)), overview: buildOverview(rows), pricingNotice: "Pricing is confirmed by an admin." }), { status: 200 });
  }
  if (url === "/api/advertise/options") {
    return new Response(JSON.stringify({
      files: [{ id: 5, title: "Guide.pdf", fileType: "document", thumbnailUrl: null, eligible: true, reason: null }, { id: 6, title: "Hidden.pdf", fileType: "document", thumbnailUrl: null, eligible: false, reason: "Publish this file first." }],
      playlists: [], channels: [], countries: [{ code: "US", label: "United States" }], languages: [{ code: "en", label: "English" }],
    }), { status: 200 });
  }
  return new Response("{}", { status: 404 });
}

beforeEach(async () => {
  fetchMock = vi.fn(async (url: string) => respond(url));
  vi.stubGlobal("fetch", fetchMock);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
});

const text = () => container.textContent ?? "";
const buttons = () => Array.from(container.querySelectorAll("button"));
const byText = (t: string) => buttons().find((b) => (b.textContent ?? "").trim() === t || (b.textContent ?? "").includes(t));
const card = (ref: string) => container.querySelector(`[data-ref="${ref}"]`) as HTMLElement;
const click = async (el: Element | undefined) => { expect(el).toBeTruthy(); await act(async () => (el as HTMLElement).click()); };
async function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  await act(async () => { setter.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); });
}

describe("Advertise dashboard", () => {
  it("shows the new header, a Create Campaign button, real overview numbers and none of the old form", async () => {
    await act(async () => root.render(<AdvertiseSection />));
    expect(text()).toContain("Advertising");
    expect(text()).toContain("Promote your content and grow your audience with Onfile.");
    expect(byText("Create Campaign")).toBeTruthy();
    const metrics = Array.from(container.querySelectorAll('[data-testid="metric"]')).map((m) => m.textContent ?? "");
    expect(metrics).toHaveLength(6);
    expect(metrics.join("|")).toContain("Total campaigns6");
    expect(metrics.join("|")).toContain("Active campaigns1");
    expect(metrics.join("|")).toContain("Total impressions200");
    expect(metrics.join("|")).toContain("Total clicks10");
    expect(metrics.join("|")).toContain("Verified joinsN/A"); // no join campaigns → honest "not applicable"
    expect(metrics.join("|")).toContain("$2.50");
    for (const gone of ["Company / Advertiser Name", "Contact Email", "Ad Network Preference", "Monthly Views", "Active Users", "Adsgram", "Adsonar", "Monitag"]) expect(text()).not.toContain(gone);
  });

  it("lists every status filter with counts and filters the list", async () => {
    await act(async () => root.render(<AdvertiseSection />));
    for (const label of ["All Campaigns", "Draft", "Pending Review", "Active", "Paused", "Completed", "Rejected"]) expect(container.querySelector(`[role="tab"]`)?.parentElement?.textContent).toContain(label);
    expect(container.querySelectorAll('[data-testid="campaign-card"]')).toHaveLength(6);
    await click(Array.from(container.querySelectorAll('[role="tab"]')).find((t) => t.textContent?.includes("Paused")));
    expect(container.querySelectorAll('[data-testid="campaign-card"]')).toHaveLength(2);
    await click(Array.from(container.querySelectorAll('[role="tab"]')).find((t) => t.textContent?.includes("Completed")));
    expect(container.querySelector('[data-testid="ads-empty"]')).toBeTruthy();
  });

  it("only offers actions that are valid for each status", async () => {
    await act(async () => root.render(<AdvertiseSection />));
    const labels = (ref: string) => Array.from(card(ref).querySelectorAll("button")).map((b) => (b.textContent ?? "").trim());
    expect(labels("AD-DRAFTAAA")).toEqual(["View details", "Edit draft"]);
    expect(labels("AD-PENDINGA")).toEqual(["View details"]);
    expect(labels("AD-ACTIVEAA")).toEqual(["View details", "Pause", "Performance"]);
    expect(labels("AD-PAUSEDAA")).toEqual(["View details", "Resume", "Performance"]);
    expect(labels("AD-PAUSEDBB")).toEqual(["View details", "Performance"]); // paused by admin: creator can't resume
    expect(labels("AD-REJECTAA")).toEqual(["View details"]);
    expect(card("AD-ACTIVEAA").querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("10"); // objective is clicks: 10 of target 100 = 10%
  });

  it("shows an honest error state with retry when loading fails", async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ error: "Boom" }), { status: 500 }));
    await act(async () => root.render(<AdvertiseSection />));
    expect(container.querySelector('[data-testid="ads-error"]')).toBeTruthy();
    expect(text()).toContain("Boom");
    expect(container.querySelector('[data-testid="metric"]')).toBeNull(); // no invented numbers
  });

  it("pausing asks for confirmation and sends exactly one action request", async () => {
    await act(async () => root.render(<AdvertiseSection />));
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/advertise/AD-ACTIVEAA/action") return new Response(JSON.stringify({ campaign: serializeCampaign(row({ publicId: "AD-ACTIVEAA", status: "paused", pausedBy: "creator" })) }), { status: 200 });
      return respond(url);
    });
    await click(Array.from(card("AD-ACTIVEAA").querySelectorAll("button")).find((b) => b.textContent?.includes("Pause")));
    expect(document.body.textContent).toContain("Pause this campaign?");
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/action"))).toBe(false); // nothing sent before confirming
    await click(Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Pause campaign"));
    const actionCalls = fetchMock.mock.calls.filter(([u]) => String(u).includes("/action"));
    expect(actionCalls).toHaveLength(1);
    expect(JSON.parse((actionCalls[0][1] as RequestInit).body as string)).toEqual({ action: "pause" });
  });
});

describe("Campaign wizard", () => {
  it("walks through the steps, keeps entered values when going back, and blocks Continue until a step is valid", async () => {
    await act(async () => root.render(<AdvertiseSection />));
    await click(byText("Create Campaign"));
    expect(text()).toContain("Step 1 of 7");
    const cont = () => container.querySelector('[data-testid="continue"]') as HTMLButtonElement;
    expect(cont().disabled).toBe(true); // nothing chosen yet

    await click(byText("Promote Onfile Content"));
    expect(text()).toContain("Guide.pdf");
    expect(text()).toContain("Publish this file first."); // ineligible content is shown but disabled
    expect((byText("Hidden.pdf") as HTMLButtonElement).disabled).toBe(true);
    await click(byText("Guide.pdf"));
    expect(cont().disabled).toBe(false);
    await click(cont());

    expect(text()).toContain("Step 2 of 7");
    expect(text()).not.toContain("Gain Verified Channel Joins"); // not measurable for Onfile content
    expect(text()).toContain("Increase Impressions");
    expect(text()).toContain("Increase Clicks");
    await click(byText("Increase Clicks"));
    await click(cont());

    expect(text()).toContain("Step 3 of 7");
    const headline = container.querySelector("#ad-headline") as HTMLInputElement;
    await type(headline, "Read my guide");
    expect(container.querySelector('[data-testid="ad-preview"]')?.textContent).toContain("Read my guide");
    await type(container.querySelector("#ad-title") as HTMLInputElement, "T");
    await type(container.querySelector("#ad-desc") as HTMLTextAreaElement, "<b>bad</b>");
    await click(cont());
    expect(text()).toContain("Step 3 of 7"); // markup rejected → can't continue
    expect(text()).toContain("can't contain HTML");
    await type(container.querySelector("#ad-desc") as HTMLTextAreaElement, "A great guide.");
    await click(cont());

    // placements (Onfile content: force join is for channel campaigns only; the explanatory notice is shown)
    expect(text()).toContain("Step 4 of 7");
    expect(text()).toContain("Force join");
    expect(cont().disabled).toBe(true);
    await click(byText("Library"));
    expect(cont().disabled).toBe(false);

    // going back preserves values
    await click(byText("Back")); // placements → creative
    expect((container.querySelector("#ad-headline") as HTMLInputElement).value).toBe("Read my guide");
    expect((container.querySelector("#ad-desc") as HTMLTextAreaElement).value).toBe("A great guide.");
  });

  it("offers only supported placements and an honest pricing/payment summary", async () => {
    await act(async () => root.render(<AdvertiseSection />));
    await click(byText("Create Campaign"));
    await click(byText("Promote Onfile Content"));
    const next = () => click(container.querySelector('[data-testid="continue"]') as HTMLElement);
    await click(byText("Guide.pdf"));
    await next(); // → objective
    await click(byText("Increase Impressions"));
    await next(); // → creative
    await type(container.querySelector("#ad-headline") as HTMLInputElement, "H");
    await type(container.querySelector("#ad-title") as HTMLInputElement, "T");
    await type(container.querySelector("#ad-desc") as HTMLTextAreaElement, "D");
    await next(); // → placements
    expect(text()).toContain("Step 4 of 7");
    expect(text()).not.toContain("Channel join promotion"); // channel-only placement is hidden for content campaigns
    expect(text()).toContain("Force join is mandatory"); // explained, but only channel campaigns can select it
    expect(text()).not.toContain("Not available yet");
    await click(byText("Library"));
    await click(container.querySelector('[data-testid="continue"]') as HTMLElement); // → audience
    expect(text()).toContain("Device / platform targeting isn't offered");
    await click(container.querySelector('[data-testid="continue"]') as HTMLElement); // → budget
    expect(text()).toContain("Pending admin confirmation");
    expect(text()).toContain("nothing is taken from your wallet");
    expect(text()).not.toMatch(/\$\d+(\.\d+)? per click|CPM of|CPC of/i); // no invented rate
  });
});

describe("SponsoredSlot", () => {
  it("renders nothing when there is no eligible campaign, and nothing on errors", async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ ad: null }), { status: 200 }));
    await act(async () => root.render(<SponsoredSlot slot="library" />));
    expect(container.innerHTML).toBe("");
    fetchMock.mockImplementation(async () => { throw new Error("offline"); });
    await act(async () => root.render(<SponsoredSlot slot="file_access" />));
    expect(container.innerHTML).toBe("");
  });

  it("renders the served ad labelled 'Sponsored', reports one impression, and opens only the server-validated URL on click", async () => {
    const opened = vi.fn();
    vi.stubGlobal("open", opened);
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).startsWith("/api/ads/serve")) return new Response(JSON.stringify({ ad: { token: "tok", adType: "telegram_post", objective: "clicks", headline: "<b>Hi</b> there", description: "d", ctaText: "View post", thumbnailUrl: null, channelTitle: "C", joinFlow: false } }), { status: 200 });
      const body = JSON.parse((init?.body as string) ?? "{}");
      if (body.type === "click") return new Response(JSON.stringify({ recorded: true, url: "https://evil.example/phish" }), { status: 200 });
      return new Response(JSON.stringify({ recorded: true }), { status: 200 });
    });
    await act(async () => root.render(<SponsoredSlot slot="library" />));
    expect(container.textContent).toContain("Sponsored");
    expect(container.querySelector("b")).toBeNull(); // headline is rendered as text, never as HTML
    expect(container.textContent).toContain("<b>Hi</b> there");
    const events = () => fetchMock.mock.calls.filter(([u]) => u === "/api/ads/event").map(([, i]) => JSON.parse((i as RequestInit).body as string));
    expect(events().filter((e) => e.type === "impression")).toHaveLength(1);
    await click(byText("View post"));
    expect(events().filter((e) => e.type === "click")).toHaveLength(1);
    expect(opened).not.toHaveBeenCalled(); // a non-Telegram URL is refused client-side even if the server returned it
  });
});
