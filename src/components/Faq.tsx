"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, HelpCircle, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { FAQ_CATEGORIES, FAQ_ENTRIES, type FaqCategoryId } from "@/content/faq";
import { searchFaq } from "@/lib/faqSearch";

/** Kept for callers that deep-link into the FAQ: maps the old two-section ids onto the new categories. */
export type FaqSection = "connect" | "general";
const SECTION_TO_CATEGORY: Record<FaqSection, FaqCategoryId> = { connect: "channel", general: "getting-started" };

export interface FaqLink {
  label: string;
  onClick: () => void;
}

/**
 * FAQ & Help center (Me › Support › FAQ & Help). Content lives in src/content/faq.ts.
 * It has no back control of its own: the host screen (ProfileTab) registers Telegram's native Back Button while it
 * is open. `links` adds shortcuts to the legal pages at the bottom.
 */
export default function Faq({ highlightSection, links }: { highlightSection?: FaqSection; links?: FaqLink[] }) {
  const initialCategory: FaqCategoryId | "all" = highlightSection ? SECTION_TO_CATEGORY[highlightSection] : "all";
  const [category, setCategory] = useState<FaqCategoryId | "all">(initialCategory);
  const [query, setQuery] = useState("");
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const results = useMemo(() => searchFaq(FAQ_ENTRIES, query, category), [query, category]);
  const searching = query.trim() !== "";

  // Group by category, keeping the order of FAQ_CATEGORIES (search results keep their relevance order inside a group).
  const groups = useMemo(() => {
    return FAQ_CATEGORIES.map((cat) => ({ cat, items: results.filter((e) => e.category === cat.id) })).filter((g) => g.items.length > 0);
  }, [results]);

  const toggle = (id: string) =>
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const pickCategory = (id: FaqCategoryId | "all") => {
    setCategory(id);
    listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const activeCategory = FAQ_CATEGORIES.find((c) => c.id === category);

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <div>
        <h1 className="text-lg font-bold text-primary">FAQ &amp; Help</h1>
        <p className="text-xs text-secondary mt-0.5">Answers about connecting a channel, sharing files, your wallet and more.</p>
      </div>

      {/* Search */}
      <div role="search" className="relative">
        <label htmlFor="faq-search" className="sr-only">
          Search help articles
        </label>
        <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" aria-hidden="true" />
        <input
          id="faq-search"
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          className="input-app text-sm pl-10 pr-10 min-h-12"
          placeholder="Search, e.g. withdraw, QR code, password"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          maxLength={100}
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Clear search"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center text-muted hover:text-primary"
          >
            <X size={16} aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Category navigation */}
      <nav aria-label="Help categories" className="-mx-4 px-4 overflow-x-auto">
        <ul className="flex gap-2 pb-1 w-max">
          {[{ id: "all" as const, title: "All topics" }, ...FAQ_CATEGORIES].map((c) => {
            const active = category === c.id;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => pickCategory(c.id)}
                  aria-pressed={active}
                  className={cn(
                    "px-3.5 min-h-10 rounded-full text-xs font-semibold whitespace-nowrap border transition-colors",
                    active ? "gradient-brand text-white border-transparent" : "bg-card text-secondary border-app hover:text-primary"
                  )}
                >
                  {c.title}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div ref={listRef} className="scroll-mt-4 flex flex-col gap-5" aria-live="polite">
        {activeCategory && !searching && <p className="text-xs text-secondary px-1">{activeCategory.description}</p>}
        {searching && (
          <p className="text-xs text-secondary px-1" data-testid="faq-result-count">
            {results.length === 0 ? "No results" : `${results.length} ${results.length === 1 ? "result" : "results"}`} for “{query.trim()}”
            {category !== "all" && activeCategory ? ` in ${activeCategory.title}` : ""}
          </p>
        )}

        {groups.length === 0 ? (
          <div className="bg-card rounded-2xl border border-app p-6 flex flex-col items-center text-center gap-3" data-testid="faq-empty">
            <HelpCircle size={30} className="text-muted opacity-50" aria-hidden="true" />
            <div>
              <p className="text-sm font-semibold text-primary">Nothing matches your search</p>
              <p className="text-xs text-secondary mt-1">Try different words, or browse all topics.</p>
            </div>
            <button
              type="button"
              className="btn-secondary px-4 py-2 text-xs"
              onClick={() => {
                setQuery("");
                setCategory("all");
              }}
            >
              Clear search
            </button>
          </div>
        ) : (
          groups.map(({ cat, items }) => (
            <section key={cat.id} aria-labelledby={`faq-cat-${cat.id}`} className="flex flex-col gap-2">
              <h2 id={`faq-cat-${cat.id}`} className="text-xs font-semibold text-secondary uppercase tracking-wide px-1">
                {cat.title}
              </h2>
              <div className="bg-card rounded-2xl border border-app shadow-app-sm overflow-hidden">
                {items.map((item) => {
                  const isOpen = openIds.has(item.id);
                  const panelId = `faq-panel-${item.id}`;
                  return (
                    <div key={item.id} className="border-b border-app last:border-0">
                      <h3>
                        <button
                          type="button"
                          onClick={() => toggle(item.id)}
                          aria-expanded={isOpen}
                          aria-controls={panelId}
                          className="w-full flex items-center gap-3 px-4 py-3.5 min-h-12 text-left"
                        >
                          <HelpCircle size={15} className="text-brand flex-shrink-0" aria-hidden="true" />
                          <span className="flex-1 text-sm font-medium text-primary">{item.question}</span>
                          <ChevronDown size={15} className={cn("text-muted flex-shrink-0 transition-transform", isOpen && "rotate-180")} aria-hidden="true" />
                        </button>
                      </h3>
                      {isOpen && (
                        <div id={panelId} role="region" aria-label={item.question} className="px-4 pb-4 pl-11 flex flex-col gap-2.5">
                          {item.answer.map((p, i) => (
                            <p key={i} className="text-sm text-secondary leading-relaxed">
                              {p}
                            </p>
                          ))}
                          {item.steps && (
                            <ol className="list-decimal pl-5 flex flex-col gap-1.5 text-sm text-secondary leading-relaxed marker:text-brand marker:font-semibold">
                              {item.steps.map((step, i) => (
                                <li key={i}>{step}</li>
                              ))}
                            </ol>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </div>

      {links && links.length > 0 && (
        <div className="bg-card rounded-2xl border border-app shadow-app-sm overflow-hidden">
          <p className="px-4 pt-3 pb-1 text-xs font-semibold text-secondary uppercase tracking-wide">More information</p>
          {links.map((link) => (
            <button
              key={link.label}
              type="button"
              onClick={link.onClick}
              className="w-full flex items-center gap-3 px-4 py-3.5 min-h-12 text-left border-t border-app first:border-0 hover:bg-secondary"
            >
              <span className="flex-1 text-sm font-medium text-primary">{link.label}</span>
              <ChevronDown size={14} className="text-muted -rotate-90 flex-shrink-0" aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
