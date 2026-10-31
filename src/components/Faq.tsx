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
 * section (Support > FAQ & Help) and anywhere else in the app that links
 * into it — the content is never duplicated between entry points, only the
 * navigation context differs.
 *
 * The "connect" section below is the explanation of why/how channel
 * connection works, previously split between a "Why connect?" button on the
 * Channel Connect screen and this page. That button has been removed from
 * the Channel Connect screen (see src/components/setup/ChannelConnectScreen.tsx);
 * this FAQ is now the only place that explanation lives. Every answer
 * describes what the current implementation actually does — see
 * src/lib/telegramBot.ts and src/lib/channelConnection.ts for the
 * corresponding code.
 */
const FAQ_ITEMS: FaqItem[] = [
  {
    id: "connect-why",
    section: "connect",
    question: "Why do I need to connect my Telegram channel?",
    answer:
      "Onfile needs a verified connection to your Telegram channel so it can confirm you're the creator behind the content, deliver eligible files to the people you share links with, and unlock channel-dependent creator features like publishing and smart links. Without a verified channel, Onfile has no reliable way to associate a file with its rightful creator.",
  },
  {
    id: "connect-admin",
    section: "connect",
    question: "Why does Onfile require administrator access?",
    answer:
      "Telegram only lets a bot post messages in a channel if it has been added as an administrator with that specific right. Onfile's bot requests administrator status purely so it can post/deliver files on your behalf — the exact same permission (\"Post Messages\") is requested whether you use Connect Channel via Bot or Manual Connect, and nothing beyond it.",
  },
  {
    id: "connect-private-only",
    section: "connect",
    question: "Why are only private channels supported?",
    answer:
      "Onfile is built around private channels so that access to your content stays under your control. The backend checks every connection attempt — regardless of which method you use — and rejects any channel that has a public @username, even if the bot already has administrator rights there. This check cannot be bypassed from the picker or the manual link form.",
  },
  {
    id: "connect-storage",
    section: "connect",
    question: "Is my channel content stored on Onfile servers?",
    answer:
      "No. Onfile is designed to use the files already hosted on Telegram's servers instead of downloading and re-uploading them to its own storage. Smart links reference the original Telegram message/file rather than duplicating it. Onfile's database only stores the channel's Telegram ID, name, and connection/verification status — not your files.",
  },
  {
    id: "connect-permissions",
    section: "connect",
    question: "What permissions does the Onfile Bot need?",
    answer:
      "Only the ability to post messages in your channel. Every other administrator right (changing channel info, deleting messages, inviting or removing members, promoting other admins, managing video chats, posting stories, etc.) is explicitly left disabled in the permissions Onfile requests from Telegram.",
  },
  {
    id: "connect-disconnect",
    section: "connect",
    question: "Can I disconnect my channel later?",
    answer:
      "Yes. You can disconnect a connected channel any time from Channel Management in the Me tab. Onfile makes a best-effort attempt to remove the bot from the channel when you do; the bot is never automatically removed or demoted outside of an action you take.",
  },
  {
    id: "connect-public-rejected",
    section: "connect",
    question: "What happens if I select a public channel?",
    answer:
      "The connection is rejected with a \"Public Channel Not Supported\" message, and no active connection is created. Onfile does not automatically demote or remove the bot from that channel — if you added it there, you'll need to remove it yourself from Telegram. Then select or link a private channel instead.",
  },
  {
    id: "connect-bot-vs-manual",
    section: "connect",
    question: "What is the difference between Connect Channel via Bot and Manual Connect?",
    answer:
      "Connect Channel via Bot uses Telegram's own native chat-selection screen, opened directly from Onfile — you pick your channel and approve the bot's admin access entirely inside Telegram's own UI. Manual Connect instead asks you to add the bot as an administrator yourself from your channel's settings, then paste the channel's private invite link into Onfile. Both methods end with the exact same backend verification before a connection is activated.",
  },
  {
    id: "connect-unsupported-client",
    section: "connect",
    question: "What should I do if Telegram does not support direct channel selection?",
    answer:
      "Connect Channel via Bot requires a recent Telegram app version (Bot API 9.6 or newer). If you see a \"Telegram Update Required\" message, update Telegram from your device's app store and try again, or use Manual Connect instead — it works on any Telegram version.",
  },
  {
    id: "connect-fix-failed",
    section: "connect",
    question: "How can I fix a failed channel connection?",
    answer:
      "Check the specific error shown: it will tell you whether the channel needs to be private, whether the bot still needs to be added or made an administrator, or whether the bot needs the \"Post Messages\" permission enabled. Fix that in Telegram, then tap \"Try Again\" (Connect Channel via Bot) or resubmit the link (Manual Connect) — Onfile re-verifies against live Telegram data every time.",
  },
  {
    id: "general-no-channel",
    section: "general",
    question: "Can I use Onfile without connecting a private channel?",
    answer:
      "Yes, you can view Onfile's introduction and onboarding screens without connecting a channel. However, creator features that depend on a connected channel — publishing files, creating playlists/smart links, and monetization — require a verified private channel first.",
  },
  {
    id: "general-earnings",
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
            {FAQ_ITEMS.filter((item) => item.section === section).map((item, idx) => {
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
