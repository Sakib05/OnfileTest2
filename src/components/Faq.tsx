"use client";
import React, { useEffect, useRef, useState } from "react";
import { ArrowLeft, ChevronDown, HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export type FaqSection = "connect" | "general";

interface FaqItem {
  id: string;
  section: FaqSection;
  question: string;
  answer: string;
}

/**
 * Single source of truth for Onfile's FAQ content. Reused by both the "Me"
 * section (Support > FAQ & Help) and the "Why connect?" entry point on the
 * Channel Connect screen — the content is never duplicated between the two
 * entry points, only the navigation context differs.
 */
const FAQ_ITEMS: FaqItem[] = [
  {
    id: "q1",
    section: "connect",
    question: "Why do I need to connect a Telegram channel?",
    answer:
      "Onfile needs a verified connection to your Telegram channel so it can confirm you're the creator behind the content, deliver eligible files to the people you share links with, and unlock channel-dependent creator features like publishing and smart links. Without a verified channel, Onfile has no reliable way to associate a file with its rightful creator.",
  },
  {
    id: "q2",
    section: "connect",
    question: "Why is a private channel mandatory?",
    answer:
      "Onfile is built around private channels so that access to your content stays under your control: Onfile's bot and the verification process are designed around that controlled-sharing model. That said, a private channel does not guarantee complete protection against copying, redistribution, or copyright infringement once a file is shared — please use Onfile's access controls (passwords, pricing, etc.) thoughtfully.",
  },
  {
    id: "q3",
    section: "general",
    question: "Will Onfile upload or permanently store my files on its own servers?",
    answer:
      "Onfile is designed to use the files already hosted on Telegram's servers instead of downloading and re-uploading them to its own storage. Smart links reference the original Telegram message/file rather than duplicating it. If you ever notice behavior that doesn't match this, please report it — this is the intended architecture and any discrepancy would be a bug, not a feature.",
  },
  {
    id: "q4",
    section: "connect",
    question: "Will I lose ownership of my channel?",
    answer:
      "No. You remain the owner/administrator of your channel at all times. Onfile's bot is only ever granted administrator rights within your channel — specifically the ability to post messages so it can deliver files on your behalf. It is never given rights to change your channel's info, invite or remove members, promote other admins, or delete your content.",
  },
  {
    id: "q5",
    section: "general",
    question: "Can I use Onfile without connecting a private channel?",
    answer:
      "Yes, you can view Onfile's introduction and onboarding screens without connecting a channel. However, creator features that depend on a connected channel — publishing files, creating playlists/smart links, and monetization — require a verified private channel first.",
  },
  {
    id: "q6",
    section: "connect",
    question: "Can I disconnect my channel later?",
    answer:
      "Yes. You can disconnect a connected channel any time from Channel Management in the Me tab. Keep in mind that disconnecting will affect file delivery and any other feature that depends on that channel — links tied to it may stop working for new deliveries until you reconnect a verified channel.",
  },
  {
    id: "q7",
    section: "general",
    question: "Can I earn money through Onfile?",
    answer:
      "Onfile is designed to let creators monetize downloads and content over time. However, we can't guarantee any specific earnings — actual monetization depends on your eligibility, feature availability in your account, platform rules, and other applicable conditions.",
  },
];

const SECTION_LABEL: Record<FaqSection, string> = {
  connect: "Connecting your channel",
  general: "General",
};

export default function Faq({
  onBack,
  highlightSection,
  backLabel = "Back",
}: {
  onBack: () => void;
  highlightSection?: FaqSection;
  backLabel?: string;
}) {
  const [openIds, setOpenIds] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    if (highlightSection) {
      FAQ_ITEMS.filter((item) => item.section === highlightSection).forEach((item) => initial.add(item.id));
    }
    return initial;
  });
  const highlightRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (highlightSection && highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    // Only scroll on initial mount for the requested section.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (id: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const sections: FaqSection[] = ["connect", "general"];

  return (
    <div className="flex flex-col gap-5 animate-fade-in">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center flex-shrink-0">
          <ArrowLeft size={16} style={{ color: "var(--color-text)" }} />
        </button>
        <div>
          <h1 className="text-lg font-bold text-primary">FAQ &amp; Help</h1>
          <p className="text-xs text-secondary">{backLabel}</p>
        </div>
      </div>

      {sections.map((section) => (
        <div key={section} className="flex flex-col gap-3">
          <h2 className="text-xs font-semibold text-secondary uppercase tracking-wide px-1">
            {SECTION_LABEL[section]}
          </h2>
          <div className="bg-card rounded-2xl border border-app shadow-app-sm overflow-hidden">
            {FAQ_ITEMS.filter((item) => item.section === section).map((item, idx, arr) => {
              const isOpen = openIds.has(item.id);
              const isHighlighted = highlightSection === section;
              return (
                <div
                  key={item.id}
                  ref={isHighlighted && idx === 0 ? highlightRef : undefined}
                  className={cn("border-b border-app last:border-0", isHighlighted && "bg-brand-10/40")}
                >
                  <button
                    onClick={() => toggle(item.id)}
                    className="w-full flex items-center gap-3 px-4 py-3.5 text-left"
                  >
                    <HelpCircle size={15} className="text-brand flex-shrink-0" />
                    <span className="flex-1 text-sm font-medium text-primary">{item.question}</span>
                    <ChevronDown
                      size={15}
                      className={cn("text-muted flex-shrink-0 transition-transform", isOpen && "rotate-180")}
                    />
                  </button>
                  {isOpen && (
                    <div className="px-4 pb-4 pl-11">
                      <p className="text-sm text-secondary leading-relaxed">{item.answer}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
