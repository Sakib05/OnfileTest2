import type { FaqCategoryId, FaqEntry } from "@/content/faq";

/** Lower-cases, strips accents/punctuation noise and collapses whitespace. */
export function normalizeSearchText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}$]+/gu, " ")
    .trim();
}

function haystack(entry: FaqEntry): string {
  return normalizeSearchText(
    [entry.question, ...entry.answer, ...(entry.steps ?? []), ...(entry.keywords ?? [])].join(" ")
  );
}

/**
 * Returns the entries matching `query` (optionally within one category), best matches first.
 * Every word of the query must appear somewhere in the entry (question, answer, steps or keywords).
 * Question matches rank above answer-only matches. An empty query returns the category's entries in their
 * written order.
 */
export function searchFaq(entries: FaqEntry[], query: string, category: FaqCategoryId | "all" = "all"): FaqEntry[] {
  const pool = category === "all" ? entries : entries.filter((e) => e.category === category);
  const words = normalizeSearchText(query).split(" ").filter(Boolean);
  if (words.length === 0) return pool;

  const scored: Array<{ entry: FaqEntry; score: number; index: number }> = [];
  pool.forEach((entry, index) => {
    const text = haystack(entry);
    if (!words.every((w) => text.includes(w))) return;
    const q = normalizeSearchText(entry.question);
    const keywords = normalizeSearchText((entry.keywords ?? []).join(" "));
    let score = 0;
    for (const w of words) {
      if (q.includes(w)) score += 3;
      if (keywords.includes(w)) score += 2;
      score += 1;
    }
    scored.push({ entry, score, index });
  });
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.map((s) => s.entry);
}
