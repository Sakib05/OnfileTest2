import { describe, expect, it } from "vitest";
import { FAQ_CATEGORIES, FAQ_ENTRIES } from "@/content/faq";
import { normalizeSearchText, searchFaq } from "./faqSearch";

describe("FAQ content integrity", () => {
  it("has unique ids and only known categories, and every category has entries", () => {
    const ids = FAQ_ENTRIES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    const cats = new Set(FAQ_CATEGORIES.map((c) => c.id));
    for (const e of FAQ_ENTRIES) expect(cats.has(e.category), e.id).toBe(true);
    for (const c of FAQ_CATEGORIES) expect(FAQ_ENTRIES.some((e) => e.category === c.id), c.id).toBe(true);
  });

  it("every entry has a question and a non-empty answer", () => {
    for (const e of FAQ_ENTRIES) {
      expect(e.question.trim().length, e.id).toBeGreaterThan(5);
      expect(e.answer.length, e.id).toBeGreaterThan(0);
      for (const p of e.answer) expect(p.trim().length, e.id).toBeGreaterThan(10);
    }
  });

  it("states the $10 USD minimum withdrawal", () => {
    const all = FAQ_ENTRIES.map((e) => [e.question, ...e.answer, ...(e.steps ?? [])].join(" ")).join(" ");
    expect(all).toContain("$10 USD");
    expect(all).not.toMatch(/minimum[^.]{0,40}\b1 USDT/i);
  });

  it("does not describe features that do not exist or promise earnings/timings", () => {
    const all = FAQ_ENTRIES.map((e) => [e.question, ...e.answer, ...(e.steps ?? [])].join(" ")).join(" ").toLowerCase();
    expect(all).not.toMatch(/end card/);
    expect(all).not.toMatch(/guaranteed (earnings|payment)/);
    expect(all).not.toMatch(/within \d+(-\d+)? hours/);
    expect(all).not.toMatch(/\d+% (of|commission)/);
  });
});

describe("searchFaq", () => {
  it("returns everything for an empty query, or the category's entries when filtered", () => {
    expect(searchFaq(FAQ_ENTRIES, "")).toHaveLength(FAQ_ENTRIES.length);
    expect(searchFaq(FAQ_ENTRIES, "   ")).toHaveLength(FAQ_ENTRIES.length);
    const wd = searchFaq(FAQ_ENTRIES, "", "withdrawals");
    expect(wd.length).toBeGreaterThan(3);
    expect(wd.every((e) => e.category === "withdrawals")).toBe(true);
  });

  it("finds the minimum withdrawal entry first for 'minimum withdrawal' and for '$10'", () => {
    expect(searchFaq(FAQ_ENTRIES, "minimum withdrawal")[0].id).toBe("min-withdrawal");
    expect(searchFaq(FAQ_ENTRIES, "$10").map((e) => e.id)).toContain("min-withdrawal");
  });

  it("matches synonyms from keywords, ignores case and accents", () => {
    expect(searchFaq(FAQ_ENTRIES, "PAYOUT").map((e) => e.id)).toContain("withdraw-steps");
    expect(searchFaq(FAQ_ENTRIES, "qr").map((e) => e.id)).toContain("qr-how");
    expect(normalizeSearchText("  Café—QR!! ")).toBe("cafe qr");
  });

  it("requires every word to match, and respects the category filter", () => {
    expect(searchFaq(FAQ_ENTRIES, "qr zzzzqqq")).toEqual([]);
    const inQr = searchFaq(FAQ_ENTRIES, "qr", "qr");
    expect(inQr.length).toBeGreaterThan(0);
    expect(inQr.every((e) => e.category === "qr")).toBe(true);
    expect(searchFaq(FAQ_ENTRIES, "qr", "wallet")).toEqual([]);
  });

  it("returns [] for gibberish", () => {
    expect(searchFaq(FAQ_ENTRIES, "xxqzzv")).toEqual([]);
  });
});
