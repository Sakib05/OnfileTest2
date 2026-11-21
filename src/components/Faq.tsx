"use client";
import React, { useMemo, useState } from "react";
import { ChevronDown, HelpCircle, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { FAQ_CATEGORIES, FAQ_ITEMS, type FaqCategoryId, type FaqItem } from "@/content/faq";

/** Pure search used by the UI and its tests: every term must appear in the question or the answer. */
export function searchFaq(items: FaqItem[], query: string): FaqItem[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return items;
  return items.filter((item) => {
    const hay = `${item.question} ${item.answer.join(" ")}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}

function Answer({ lines }: { lines: string[] }) {
  const out: React.ReactNode[] = [];
  let bullets: string[] = [];
  const flush = (k: string) => {
    if (bullets.length) {
      out.push(
        <ul key={k} className="list-disc pl-5 flex flex-col gap-1">
          {bullets.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      );
      bullets = [];
    }
  };
  lines.forEach((l, i) => {
    if (l.startsWith("• ")) bullets.push(l.slice(2));
    else {
      flush(`u${i}`);
      out.push(<p key={`p${i}`}>{l}</p>);
    }
  });
  flush("uend");
  return <div className="flex flex-col gap-2 text-sm text-secondary leading-relaxed break-words">{out}</div>;
}

/**
 * FAQ & Help sub-page: searchable, categorised accordion. It has no back control of its own: the host screen
 * (ProfileTab) registers Telegram's native Back Button while it is open.
 */
export default function Faq() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<FaqCategoryId | "all">("all");
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());

  const searching = query.trim().length > 0;
  const results = useMemo(() => searchFaq(FAQ_ITEMS, query), [query]);
  const visibleCategories = FAQ_CATEGORIES.filter((c) => (searching || category === "all" ? true : c.id === category));

  const toggle = (id: string) =>
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <div>
        <h1 className="text-lg font-bold text-primary">FAQ &amp; Help</h1>
        <p className="text-xs text-secondary mt-0.5">Answers about how Onfile works</p>
      </div>

      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
        <input
          type="search"
          inputMode="search"
          aria-label="Search help"
          className="input-app text-sm pl-9 pr-10 min-h-11"
          placeholder="Search help…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button
            aria-label="Clear search"
            onClick={() => setQuery("")}
            className="absolute right-1 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center text-muted"
          >
            <X size={15} />
          </button>
        )}
      </div>

      {!searching && (
        <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 pb-1" role="tablist" aria-label="Help categories">
          {[{ id: "all" as const, title: "All" }, ...FAQ_CATEGORIES].map((c) => (
            <button
              key={c.id}
              role="tab"
              aria-selected={category === c.id}
              onClick={() => setCategory(c.id)}
              className={cn(
                "flex-shrink-0 min-h-9 px-3.5 rounded-full text-xs font-semibold border transition-colors whitespace-nowrap",
                category === c.id ? "bg-brand-10 border-[#FF6115] text-brand" : "border-app text-secondary bg-card"
              )}
            >
              {c.title}
            </button>
          ))}
        </div>
      )}

      {searching && results.length === 0 && (
        <div className="bg-card rounded-2xl border border-app p-6 text-center" data-testid="faq-empty">
          <HelpCircle size={28} className="text-muted mx-auto mb-2 opacity-50" />
          <p className="text-sm font-semibold text-primary">No results for “{query.trim()}”</p>
          <p className="text-xs text-secondary mt-1">Try different words, or clear the search to browse every category.</p>
          <button onClick={() => setQuery("")} className="btn-secondary px-4 py-2 text-xs mt-3">
            Clear search
          </button>
        </div>
      )}

      {visibleCategories.map((cat) => {
        const items = results.filter((i) => i.category === cat.id);
        if (items.length === 0) return null;
        return (
          <section key={cat.id} className="flex flex-col gap-2" aria-labelledby={`faq-${cat.id}`}>
            <div className="px-1">
              <h2 id={`faq-${cat.id}`} className="text-xs font-semibold text-secondary uppercase tracking-wide">
                {cat.title}
              </h2>
              {!searching && <p className="text-xs text-muted mt-0.5">{cat.blurb}</p>}
            </div>
            <div className="bg-card rounded-2xl border border-app shadow-app-sm overflow-hidden">
              {items.map((item) => {
                const isOpen = openIds.has(item.id);
                return (
                  <div key={item.id} className="border-b border-app last:border-0">
                    <button
                      onClick={() => toggle(item.id)}
                      aria-expanded={isOpen}
                      aria-controls={`faq-a-${item.id}`}
                      className="w-full flex items-center gap-3 px-4 py-3.5 min-h-12 text-left"
                    >
                      <span className="flex-1 text-sm font-medium text-primary">{item.question}</span>
                      <ChevronDown size={15} className={cn("text-muted flex-shrink-0 transition-transform", isOpen && "rotate-180")} />
                    </button>
                    {isOpen && (
                      <div id={`faq-a-${item.id}`} className="px-4 pb-4">
                        <Answer lines={item.answer} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
