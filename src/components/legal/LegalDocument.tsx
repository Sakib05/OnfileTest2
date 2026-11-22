"use client";
import React, { useEffect } from "react";
import { AlertTriangle, ChevronRight, List } from "lucide-react";
import {
  LEGAL_CONFIG,
  LEGAL_FIELD_LABELS,
  isLegalConfigComplete,
  legalValue,
  missingLegalFields,
  type LegalConfig,
} from "@/config/legal";
import type { DocBlock, DocSection } from "@/content/legal/types";

export interface LegalDocumentLink {
  label: string;
  onClick: () => void;
}

interface Props {
  title: string;
  subtitle: string;
  sections: DocSection[];
  /** Cross-links shown at the bottom (e.g. to the other legal page or the FAQ). */
  links?: LegalDocumentLink[];
  config?: LegalConfig;
}

/** Text between [ ... not configured] markers is highlighted so placeholders can never be mistaken for real values. */
const PLACEHOLDER = /(\[[^\]]*not configured\])/g;

function renderText(text: string): React.ReactNode {
  return text.split(PLACEHOLDER).map((part, i) =>
    i % 2 === 1 ? ( // split() with one capture group puts every captured placeholder at an odd index
      <mark
        key={i}
        data-testid="legal-placeholder"
        className="rounded px-1 font-semibold bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300"
      >
        {part}
      </mark>
    ) : (
      <React.Fragment key={i}>{part}</React.Fragment>
    )
  );
}

function Block({ block }: { block: DocBlock }) {
  switch (block.type) {
    case "p":
      return <p className="text-sm text-secondary leading-relaxed">{renderText(block.text)}</p>;
    case "note":
      return (
        <p className="text-sm text-primary leading-relaxed p-3 rounded-xl bg-secondary border border-app">{renderText(block.text)}</p>
      );
    case "ul":
      return (
        <ul className="list-disc pl-5 flex flex-col gap-1.5 text-sm text-secondary leading-relaxed marker:text-brand">
          {block.items.map((item, i) => (
            <li key={i}>{renderText(item)}</li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol className="list-decimal pl-5 flex flex-col gap-1.5 text-sm text-secondary leading-relaxed marker:text-brand marker:font-semibold">
          {block.items.map((item, i) => (
            <li key={i}>{renderText(item)}</li>
          ))}
        </ol>
      );
  }
}

/**
 * Read-only legal page. It has no back control of its own: the host screen (ProfileTab) registers Telegram's
 * native Back Button while it is open, like every other Me sub-page.
 */
export default function LegalDocument({ title, subtitle, sections, links, config = LEGAL_CONFIG }: Props) {
  const complete = isLegalConfigComplete(config);
  const missing = missingLegalFields(config);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const jump = (id: string) => {
    document.getElementById(`legal-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <article className="flex flex-col gap-5 animate-fade-in" aria-labelledby="legal-title">
      <header>
        <h1 id="legal-title" className="text-lg font-bold text-primary">
          {title}
        </h1>
        <p className="text-xs text-secondary mt-0.5">{subtitle}</p>
        <p className="text-xs text-secondary mt-1">
          Effective date: <span className="font-medium text-primary">{renderText(legalValue("effectiveDate", config))}</span>
        </p>
      </header>

      {!complete && (
        <div
          role="note"
          data-testid="legal-draft-banner"
          className="p-3 rounded-2xl border border-yellow-300 bg-yellow-50 dark:bg-yellow-900/20 dark:border-yellow-700/60 flex items-start gap-2.5"
        >
          <AlertTriangle size={16} className="text-yellow-600 dark:text-yellow-400 mt-0.5 flex-shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-yellow-800 dark:text-yellow-300">Draft — legal details not yet configured</p>
            <p className="text-xs text-yellow-800/90 dark:text-yellow-200/90 mt-1 leading-relaxed">
              This page has not been finalized. Highlighted placeholders must be completed by the operator, and the text reviewed by a
              qualified lawyer, before it is relied on. Still to configure: {missing.map((k) => LEGAL_FIELD_LABELS[k]).join(", ")}.
            </p>
          </div>
        </div>
      )}

      <details className="bg-card rounded-2xl border border-app shadow-app-sm group">
        <summary className="flex items-center gap-2 px-4 py-3 text-sm font-semibold text-primary cursor-pointer list-none">
          <List size={15} className="text-brand" aria-hidden="true" />
          <span className="flex-1">Contents</span>
          <ChevronRight size={15} className="text-muted transition-transform group-open:rotate-90" aria-hidden="true" />
        </summary>
        <nav aria-label={`${title} contents`} className="px-2 pb-2">
          <ol className="flex flex-col">
            {sections.map((section, i) => (
              <li key={section.id}>
                <button
                  type="button"
                  onClick={() => jump(section.id)}
                  className="w-full text-left px-2 py-2 min-h-11 rounded-lg text-sm text-secondary hover:bg-secondary flex gap-2"
                >
                  <span className="text-muted tabular-nums w-6 flex-shrink-0">{i + 1}.</span>
                  <span>{section.title}</span>
                </button>
              </li>
            ))}
          </ol>
        </nav>
      </details>

      <div className="flex flex-col gap-4">
        {sections.map((section, i) => (
          <section
            key={section.id}
            id={`legal-${section.id}`}
            aria-labelledby={`legal-h-${section.id}`}
            className="bg-card rounded-2xl border border-app shadow-app-sm p-4 flex flex-col gap-3 scroll-mt-4"
          >
            <h2 id={`legal-h-${section.id}`} className="text-sm font-bold text-primary">
              {i + 1}. {section.title}
            </h2>
            {section.blocks.map((block, j) => (
              <Block key={j} block={block} />
            ))}
          </section>
        ))}
      </div>

      {links && links.length > 0 && (
        <div className="bg-card rounded-2xl border border-app shadow-app-sm overflow-hidden">
          {links.map((link) => (
            <button
              key={link.label}
              type="button"
              onClick={link.onClick}
              className="w-full flex items-center gap-3 px-4 py-3.5 min-h-12 text-left border-b border-app last:border-0 hover:bg-secondary"
            >
              <span className="flex-1 text-sm font-medium text-primary">{link.label}</span>
              <ChevronRight size={14} className="text-muted flex-shrink-0" aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
    </article>
  );
}
