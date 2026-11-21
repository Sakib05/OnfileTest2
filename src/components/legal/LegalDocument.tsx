"use client";
import React from "react";
import { AlertTriangle } from "lucide-react";
import type { LegalSection } from "@/content/privacy";
import { formatLegalDate, isPlaceholder, LEGAL_LAST_UPDATED } from "@/content/legalConfig";

/** Renders text, visually marking any "[To be configured: …]" placeholder so missing legal details are obvious. */
function RichLine({ text }: { text: string }) {
  const parts = text.split(/(\[To be configured:[^\]]*\])/g);
  return (
    <>
      {parts.map((part, i) =>
        isPlaceholder(part) && part.startsWith("[") ? (
          <mark key={i} className="rounded px-1 bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300">
            {part}
          </mark>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        )
      )}
    </>
  );
}

function SectionBody({ lines }: { lines: string[] }) {
  const out: React.ReactNode[] = [];
  let bullets: string[] = [];
  const flush = (key: string) => {
    if (bullets.length) {
      out.push(
        <ul key={key} className="list-disc pl-5 flex flex-col gap-1">
          {bullets.map((b, i) => (
            <li key={i}>
              <RichLine text={b} />
            </li>
          ))}
        </ul>
      );
      bullets = [];
    }
  };
  lines.forEach((line, i) => {
    if (line.startsWith("• ")) {
      bullets.push(line.slice(2));
    } else {
      flush(`ul-${i}`);
      out.push(
        <p key={`p-${i}`}>
          <RichLine text={line} />
        </p>
      );
    }
  });
  flush("ul-end");
  return <div className="flex flex-col gap-2 text-sm text-secondary leading-relaxed break-words">{out}</div>;
}

/**
 * Shared readable layout for the legal pages: heading, last-updated date, "draft" notice and numbered sections.
 * No back control of its own — Telegram's native Back Button (registered by the host screen) is the only back control.
 */
export default function LegalDocument({
  title,
  intro,
  sections,
  showDraftNotice = true,
  headingLevel = "h1",
}: {
  title: string;
  intro?: string;
  sections: LegalSection[];
  showDraftNotice?: boolean;
  headingLevel?: "h1" | "h2";
}) {
  const Heading = headingLevel;
  return (
    <article className="flex flex-col gap-4" data-testid="legal-document">
      <header className="flex flex-col gap-1">
        <Heading className="text-lg font-bold text-primary">{title}</Heading>
        <p className="text-xs text-muted">Last updated: {formatLegalDate(LEGAL_LAST_UPDATED)}</p>
        {intro && <p className="text-sm text-secondary mt-1">{intro}</p>}
      </header>

      {showDraftNotice && (
        <div className="flex items-start gap-2.5 p-3 rounded-xl border border-app bg-secondary text-xs text-secondary" role="note">
          <AlertTriangle size={14} className="text-yellow-500 flex-shrink-0 mt-0.5" />
          <p>
            This is an implementation draft that needs legal review before it is treated as final. Highlighted
            placeholders mark business details that have not been configured yet.
          </p>
        </div>
      )}

      <div className="bg-card rounded-2xl border border-app shadow-app-sm divide-y divide-[var(--color-border)]">
        {sections.map((s) => (
          <section key={s.id} id={s.id} className="p-4 flex flex-col gap-2" aria-labelledby={`${s.id}-h`}>
            <h2 id={`${s.id}-h`} className="text-sm font-semibold text-primary">
              {s.title}
            </h2>
            <SectionBody lines={s.body} />
          </section>
        ))}
      </div>
    </article>
  );
}
