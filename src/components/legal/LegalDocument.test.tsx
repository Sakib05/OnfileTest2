// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LegalDocument from "./LegalDocument";
import { buildPrivacySections } from "@/content/legal/privacy";
import { buildTermsSections } from "@/content/legal/terms";
import { LEGAL_CONFIG, isLegalConfigComplete, missingLegalFields, type LegalConfig } from "@/config/legal";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FILLED: LegalConfig = {
  operatorName: "Example Operator Ltd",
  operatorAddress: "1 Example Street",
  contactEmail: "legal@example.test",
  privacyEmail: null,
  copyrightEmail: null,
  governingLaw: "the laws of Exampleland",
  disputeVenue: "the courts of Exampleland",
  effectiveDate: "1 January 2030",
  databaseProvider: null,
};

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  Element.prototype.scrollIntoView = vi.fn();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const renderDoc = (title: string, sections = buildTermsSections(), config?: LegalConfig) =>
  act(async () => root.render(<LegalDocument title={title} subtitle="sub" sections={sections} config={config} />));

const titles = (sections: { title: string }[]) => sections.map((s) => s.title);
const flatten = (sections: ReturnType<typeof buildTermsSections>) =>
  sections
    .flatMap((s) => s.blocks.flatMap((b) => (b.type === "ul" || b.type === "ol" ? b.items : [b.text])))
    .join("\n");

describe("legal configuration", () => {
  it("ships unconfigured (null) so nothing can be mistaken for finalized legal details", () => {
    expect(isLegalConfigComplete(LEGAL_CONFIG)).toBe(false);
    expect(missingLegalFields(LEGAL_CONFIG)).toEqual(
      expect.arrayContaining(["operatorName", "operatorAddress", "contactEmail", "governingLaw", "disputeVenue", "effectiveDate"])
    );
    expect(isLegalConfigComplete(FILLED)).toBe(true);
  });
});

describe("Terms & Conditions content", () => {
  it("contains every required section", () => {
    const t = titles(buildTermsSections());
    for (const required of [
      "Introduction", "Acceptance of Terms", "Eligibility", "Account Registration", "User Responsibilities",
      "Creator Responsibilities", "Telegram Channel Ownership & Permissions", "File Uploads and Content Ownership",
      "Copyright & Intellectual Property", "Prohibited Content and Activities", "File Access and Delivery",
      "Advertisements and Unlocking", "Creator Earnings", "Wallet and Withdrawals", "Minimum Withdrawal Amount",
      "Referral Program", "Account Suspension and Termination", "Platform Availability", "Limitation of Liability",
      "Disclaimer", "Changes to Terms", "Governing Law", "Contact Information",
    ]) {
      expect(t, required).toContain(required);
    }
  });

  it("states the $10 USD minimum and promises no earnings, rates or timings", () => {
    const text = flatten(buildTermsSections());
    expect(text).toContain("The minimum withdrawal amount is $10 USD");
    expect(text).toMatch(/Earnings are not guaranteed/);
    expect(text).not.toMatch(/\d+\s?%/);
    expect(text).not.toMatch(/within \d+/i);
  });

  it("uses placeholders (never invented details) when the legal config is empty", () => {
    const text = flatten(buildTermsSections(LEGAL_CONFIG));
    expect(text).toContain("[Governing law — not configured]");
    expect(text).toContain("[Dispute venue — not configured]");
    expect(text).toContain("[Contact email — not configured]");
  });

  it("uses configured values when provided", () => {
    const text = flatten(buildTermsSections(FILLED));
    expect(text).toContain("the laws of Exampleland");
    expect(text).toContain("Example Operator Ltd");
    expect(text).not.toContain("not configured");
  });
});

describe("Privacy & Security content", () => {
  it("contains every required section", () => {
    const t = titles(buildPrivacySections());
    for (const required of [
      "Introduction", "Information We Collect", "Telegram Account Information", "Profile Information",
      "File & Content Handling", "Telegram Channel Integration", "How We Use Information",
      "Data Storage & Third-Party Services", "File Access & Delivery", "Cookies and Similar Technologies",
      "Data Sharing", "Data Retention", "Account Security", "User Responsibilities",
      "Account Deletion & Data Removal", "Children's Privacy", "Changes to This Policy", "Contact Information",
    ]) {
      expect(t, required).toContain(required);
    }
  });

  it("states the Onfile-specific facts: private channels, originals stay in Telegram, thumbnails differ, real providers", () => {
    const text = flatten(buildPrivacySections());
    expect(text).toMatch(/Original files are not uploaded to Onfile/);
    expect(text).toMatch(/remains in the creator's Telegram channel/);
    expect(text).toMatch(/does not claim ownership/);
    expect(text).toMatch(/Thumbnails, profile images and metadata are different from original files/);
    expect(text).toMatch(/only accepts private channels/);
    expect(text).toMatch(/limited to Post Messages/);
    for (const provider of ["Telegram", "Vercel", "DBByte", "PostgreSQL"]) expect(text).toContain(provider);
    expect(text).toMatch(/not been independently certified/);
    expect(text).not.toMatch(/SOC ?2|ISO ?27001|GDPR[- ]compliant|HIPAA/i);
  });
});

describe("LegalDocument rendering", () => {
  it("shows the draft banner, highlighted placeholders and a table of contents while unconfigured", async () => {
    await renderDoc("Terms & Conditions", buildTermsSections(LEGAL_CONFIG), LEGAL_CONFIG);
    expect(container.querySelector('[data-testid="legal-draft-banner"]')?.textContent).toContain("Draft — legal details not yet configured");
    expect(container.querySelectorAll('[data-testid="legal-placeholder"]').length).toBeGreaterThan(3);
    expect(container.querySelector("h1")?.textContent).toBe("Terms & Conditions");
    expect(container.querySelectorAll("section h2").length).toBe(buildTermsSections().length);
    expect(container.querySelectorAll("nav[aria-label$='contents'] button").length).toBe(buildTermsSections().length);
  });

  it("hides the draft banner once every required value is configured", async () => {
    await renderDoc("Terms & Conditions", buildTermsSections(FILLED), FILLED);
    expect(container.querySelector('[data-testid="legal-draft-banner"]')).toBeNull();
    expect(container.querySelectorAll('[data-testid="legal-placeholder"]').length).toBe(0);
    expect(container.textContent).toContain("1 January 2030");
  });

  it("table-of-contents buttons scroll to their section", async () => {
    await renderDoc("Privacy & Security", buildPrivacySections());
    const btn = container.querySelectorAll("nav[aria-label$='contents'] button")[2] as HTMLButtonElement;
    await act(async () => btn.click());
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });
});
