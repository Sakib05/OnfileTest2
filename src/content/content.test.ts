import { describe, expect, it } from "vitest";
import { FAQ_CATEGORIES, FAQ_ITEMS } from "./faq";
import { getPrivacySections, getSecuritySections } from "./privacy";
import { getTermsSections } from "./terms";
import { LEGAL_CONFIG } from "./legalConfig";
import { searchFaq } from "@/components/Faq";

const text = (s: { title: string; body: string[] }[]) => s.map((x) => `${x.title}\n${x.body.join("\n")}`).join("\n");

describe("FAQ knowledge base", () => {
  it("covers every required category and question", () => {
    expect(FAQ_CATEGORIES.map((c) => c.title)).toEqual([
      "Getting Started", "Telegram Channel Connection", "File Management", "Playlists", "Sharing & Access",
      "Advertisements & Monetization", "Profile & Account", "Copyright & Reporting", "Troubleshooting",
    ]);
    const required = [
      "What is Onfile?", "How does Onfile work?", "Who can use Onfile?", "How do I create a creator account?", "How do I start monetizing my files?",
      "Why does Onfile require a Telegram channel?", "How do I connect my private channel?", "Why must the channel be private?",
      "Why does the Onfile bot need administrator permissions?", "What happens if I remove the bot from my channel?", "How can I reconnect my channel?",
      "What should I do if channel verification fails?",
      "How do I upload files?", "Where are original files stored?", "Does Onfile store my original files?", "How does file delivery work?",
      "Can I edit a file's title and description?", "How do I change a thumbnail?", "Can I delete a file from My Library?",
      "Does deleting a file from Onfile delete the original Telegram channel post?",
      "What is a playlist?", "How do I create a playlist?", "How do I add or remove files?", "How do I reorder files?", "Can I share a playlist?",
      "Can I protect a playlist with a password?", "How do playlist links work?",
      "How do I share a file?", "How do I copy a file link?", "How do I generate or display a QR code?", "How do users access private content?",
      "What happens when a file is password-protected?", "Can a QR code bypass access restrictions?",
      "How do advertisements work?", "Why might users see advertisements before accessing files?", "How do creators earn money?",
      "How are creator earnings calculated?", "When can creators withdraw money?", "What is the minimum withdrawal amount?",
      "How do I change my display name?", "How do I change my profile picture?", "Can I change my Telegram username through Onfile?", "How do I secure my account?",
      "What content can I upload?", "What content is prohibited?", "How do I report copyrighted content?", "What happens after a report is submitted?", "Who is responsible for uploaded content?",
      "File delivery failed", "Channel connection failed", "Playlist link does not work", "Password is not accepted", "Profile picture upload failed", "Withdrawal request failed", "Application is not loading",
    ];
    const have = FAQ_ITEMS.map((i) => i.question);
    for (const q of required) expect(have, q).toContain(q);
    expect(new Set(FAQ_ITEMS.map((i) => i.id)).size).toBe(FAQ_ITEMS.length);
    for (const i of FAQ_ITEMS) {
      expect(FAQ_CATEGORIES.some((c) => c.id === i.category)).toBe(true);
      expect(i.answer.join(" ").length, i.id).toBeGreaterThan(40);
    }
  });

  it("states the $10 USD minimum and that the Telegram username can't be changed", () => {
    const min = FAQ_ITEMS.find((i) => i.id === "m-min")!;
    expect(min.answer.join(" ")).toContain("$10 USD");
    expect(FAQ_ITEMS.find((i) => i.id === "a-username")!.answer.join(" ")).toMatch(/cannot be changed|can't be changed|cannot/i);
  });

  it("does not invent revenue rates, payout timelines or guarantees", () => {
    const all = FAQ_ITEMS.map((i) => i.answer.join(" ")).join(" ");
    expect(all).not.toMatch(/\d+\s?%/); // no commission / revenue percentages
    expect(all).not.toMatch(/\d+\s?(-|–|to)\s?\d+\s?(hours|days)/i);
    expect(all).not.toMatch(/within \d+ (hours|days)/i);
  });

  it("search matches question and answer text, requires all terms, and returns nothing for gibberish", () => {
    expect(searchFaq(FAQ_ITEMS, "").length).toBe(FAQ_ITEMS.length);
    expect(searchFaq(FAQ_ITEMS, "QR code").some((i) => i.id === "s-qr")).toBe(true);
    expect(searchFaq(FAQ_ITEMS, "minimum withdrawal").some((i) => i.id === "m-min")).toBe(true);
    expect(searchFaq(FAQ_ITEMS, "zzzzqqq")).toEqual([]);
  });
});

describe("Privacy & Security content", () => {
  it("has every required section", () => {
    const t = getPrivacySections().map((s) => s.title.replace(/^\d+\.\s*/, ""));
    for (const need of [
      "Introduction", "Information We Collect", "Telegram Account Information", "Creator Profile Information", "Uploaded Content and Telegram Storage",
      "File Access and Delivery", "Payment and Withdrawal Information", "Cookies, Local Storage, and Technical Data", "How We Use Information",
      "Data Sharing and Third-Party Services", "Data Retention", "Account and Data Deletion", "User Rights", "Children's Privacy", "Policy Updates", "Contact Information",
    ]) expect(t, need).toContain(need);
  });
  it("explains that original files are not stored by Onfile, and makes no certification / E2E claims", () => {
    const priv = text(getPrivacySections());
    expect(priv).toMatch(/does not host or store creators' original uploaded files/);
    const sec = text(getSecuritySections());
    expect(sec).toMatch(/does not offer end-to-end encryption/);
    expect(`${priv}\n${sec}`).not.toMatch(/ISO ?27001|SOC ?2|GDPR[- ]compliant|HIPAA|PCI/i);
    for (const need of ["Telegram-based authentication", "Secure API validation", "Profile image upload validation", "Protection of creator financial information", "Password protection"]) {
      expect(sec).toContain(need);
    }
  });
});

describe("Terms & Conditions content", () => {
  it("has every required section and states the minimum withdrawal as $10 USD", () => {
    const sections = getTermsSections();
    const t = sections.map((s) => s.title.replace(/^\d+\.\s*/, ""));
    for (const need of [
      "Acceptance of Terms", "About Onfile", "Eligibility", "User Accounts", "Creator Accounts", "Telegram Channel Connection", "Creator Responsibilities",
      "File Upload and Distribution", "Copyright and Intellectual Property", "Prohibited Content", "File Sharing and Access", "Playlists", "Password-Protected Content",
      "Advertisements", "Creator Earnings", "Withdrawals", "Minimum Withdrawal Amount", "Payment Processing", "Refunds and Payment Disputes", "Copyright Reports",
      "Account Suspension and Termination", "Service Availability", "Third-Party Services", "Limitation of Liability", "Changes to Terms", "Contact Information",
    ]) expect(t, need).toContain(need);
    expect(text(sections.filter((s) => s.id === "minimum"))).toContain("$10 USD");
  });
  it("lists the creator responsibilities", () => {
    const r = text(getTermsSections().filter((s) => s.id === "responsibilities"));
    for (const need of ["legal right to distribute", "copyright", "control over their connected Telegram channels", "accurate account information", "applicable laws"]) expect(r).toContain(need);
  });
  it("does not invent commissions, payout timelines, refunds or business details", () => {
    const terms = text(getTermsSections());
    expect(terms).not.toMatch(/\d+\s?%/);
    expect(terms).not.toMatch(/within \d+ (business )?(hours|days)/i);
    expect(terms).not.toMatch(/full refund|money-back/i);
  });
});

describe("legal placeholders (no invented business details)", () => {
  it("the config ships with every business detail unset, and the pages show visible placeholders for them", () => {
    expect(Object.values(LEGAL_CONFIG).every((v) => v === null)).toBe(true);
    const all = `${text(getTermsSections())}\n${text(getPrivacySections())}`;
    expect(all).toContain("[To be configured: legal entity name]");
    expect(all).toContain("[To be configured: contact e-mail]");
    expect(all).toContain("[To be configured: postal address]");
    expect(all).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.-]+/); // no e-mail addresses
    expect(all).not.toMatch(/\b(Inc\.|Ltd\.?|LLC|GmbH)\b/); // no made-up legal entity
  });
});
