"use client";
import React, { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  ClipboardPaste,
  Link2,
  Loader2,
  MessageSquareText,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  UserPlus,
  Users,
} from "lucide-react";
import type { ConnectedChannel } from "@/lib/useChannelConnect";

/** Loose client-side format check only — never treated as proof of anything.
 * The backend independently verifies the channel is private, resolves it on
 * Telegram, and confirms the bot's admin access before anything is
 * persisted (see src/lib/telegramBot.ts). */
function looksLikeChannelLink(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return /^(?:https?:\/\/)?t\.me\/[a-zA-Z0-9_]{5,32}\/?$/i.test(trimmed) || /^@?[a-zA-Z0-9_]{5,32}$/.test(trimmed);
}

interface GuideStep {
  icon: React.FC<{ size: number; className?: string }>;
  title: string;
  description: string;
  /** Short label shown inside the stylized device mockup, highlighting the
   * Telegram UI element this step refers to. This is a schematic
   * illustration (not a literal screenshot) so it stays accurate across
   * Telegram's own UI changes and app versions. */
  mockupLabel: string;
}

const BASE_STEPS: GuideStep[] = [
  {
    icon: MessageSquareText,
    title: "Open Your Telegram Channel",
    description: "Open the private Telegram channel you want to connect to Onfile.",
    mockupLabel: "Your Channel",
  },
  {
    icon: Settings,
    title: "Open Channel Settings",
    description: "Tap the channel name and open Edit or Manage Channel.",
    mockupLabel: "Edit / Manage Channel",
  },
  {
    icon: Users,
    title: "Open Administrators",
    description: "Go to the Administrators section.",
    mockupLabel: "Administrators",
  },
  {
    icon: UserPlus,
    title: "Add Onfile Bot",
    description: "Find the official Onfile Bot and add it as an administrator.",
    mockupLabel: "Add Admin",
  },
  {
    icon: Sliders,
    title: "Grant Required Permissions",
    description: "Enable only the administrator permissions required by Onfile and confirm.",
    mockupLabel: "Post Messages: On",
  },
  {
    icon: Link2,
    title: "Copy Your Channel Link",
    description: "Copy the private invite link of your Telegram channel.",
    mockupLabel: "Invite Link — Copy",
  },
];

export default function ManualConnectGuide({
  onBack,
  onConnected,
  initialLink = "",
}: {
  onBack: () => void;
  onConnected: (channel: ConnectedChannel) => void;
  initialLink?: string;
}) {
  const [stepIndex, setStepIndex] = useState(0); // 0-based, 8 steps total (0..7)
  const [link, setLink] = useState(initialLink);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [botUsername, setBotUsername] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/telegram/bot-info")
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled && data?.username) setBotUsername(data.username);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const totalSteps = 8;
  const isPasteStep = stepIndex === 6; // Step 7 (0-indexed 6): "Paste Link in Onfile"
  const isFinalStep = stepIndex === 7; // Step 8 (0-indexed 7): "Click Next to Continue"

  const stepData: GuideStep =
    stepIndex < BASE_STEPS.length
      ? stepIndex === 3
        ? { ...BASE_STEPS[3], mockupLabel: botUsername ? `@${botUsername}` : BASE_STEPS[3].mockupLabel }
        : BASE_STEPS[stepIndex]
      : stepIndex === 6
        ? {
            icon: ClipboardPaste,
            title: "Paste Link in Onfile",
            description: "Return to Onfile and paste the copied private channel link into the Manual Connect input field.",
            mockupLabel: "Private channel link",
          }
        : {
            icon: ShieldCheck,
            title: "Click Next to Continue",
            description: "Tap the Next button below to continue to the next step.",
            mockupLabel: "Ready to connect",
          };

  const goBack = () => {
    if (submitting) return;
    if (stepIndex === 0) {
      onBack();
      return;
    }
    setStepIndex((i) => i - 1);
  };

  const submitManualLink = async () => {
    if (submitting) return; // guard against duplicate submissions
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelIdentifier: link.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSubmitError(data.error || "We couldn't verify that channel. Please try again.");
        return;
      }
      onConnected(data.channel);
    } catch {
      setSubmitError("Network error. Please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const goNext = () => {
    if (submitting) return;
    if (isPasteStep) {
      if (!looksLikeChannelLink(link)) {
        setLinkError("Enter a valid private channel link, e.g. https://t.me/your_channel");
        return;
      }
      setLinkError(null);
      setStepIndex((i) => i + 1);
      return;
    }
    if (isFinalStep) {
      submitManualLink();
      return;
    }
    setStepIndex((i) => i + 1);
  };

  return (
    <div className="flex flex-col gap-5 w-full max-w-sm animate-fade-in">
      <div className="flex items-center gap-3">
        <button onClick={goBack} className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center flex-shrink-0">
          <ArrowLeft size={16} style={{ color: "var(--color-text)" }} />
        </button>
        <div>
          <h1 className="text-lg font-bold text-primary">Manual Connect Guide</h1>
          <p className="text-xs text-secondary">Step {stepIndex + 1} of {totalSteps}</p>
        </div>
      </div>

      {/* Progress indicator */}
      <div className="flex items-center gap-1.5">
        {Array.from({ length: totalSteps }).map((_, idx) => (
          <div
            key={idx}
            className={`h-1.5 flex-1 rounded-full ${idx <= stepIndex ? "gradient-brand" : "bg-secondary"}`}
          />
        ))}
      </div>

      {/* Step card */}
      <div className="bg-card rounded-2xl border border-app shadow-app-sm p-4 flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-full gradient-brand text-white text-sm font-bold flex items-center justify-center flex-shrink-0">
            {stepIndex + 1}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <stepData.icon size={14} className="text-brand" />
              <p className="text-sm font-semibold text-primary">{stepData.title}</p>
            </div>
            <p className="text-xs text-secondary mt-1 leading-relaxed">{stepData.description}</p>
          </div>
        </div>

        {/* Schematic illustration — a stylized Telegram-like panel
            highlighting the relevant UI element for this step. Not a literal
            screenshot (Telegram's actual UI varies by platform/version), so
            it stays accurate and never misrepresents controls that don't
            exist. */}
        <div className="rounded-xl border border-app bg-secondary p-3">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-5 h-5 rounded-full bg-app flex items-center justify-center">
              <Bot size={11} className="text-brand" />
            </div>
            <div className="h-1.5 w-20 rounded-full bg-app" />
          </div>
          {isPasteStep ? (
            <div className="flex flex-col gap-2">
              <input
                className="input-app text-sm"
                placeholder="https://t.me/your_channel"
                value={link}
                onChange={(e) => {
                  setLink(e.target.value);
                  if (linkError) setLinkError(null);
                }}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
              {linkError && (
                <div className="flex items-start gap-1.5 text-[11px] text-red-500">
                  <ShieldAlert size={12} className="mt-0.5 flex-shrink-0" />
                  <span>{linkError}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-between rounded-lg bg-brand-10 border border-brand/30 px-3 py-2.5">
              <span className="text-xs font-semibold text-brand truncate">{stepData.mockupLabel}</span>
              <stepData.icon size={14} className="text-brand flex-shrink-0" />
            </div>
          )}
        </div>

        {isFinalStep && link.trim() && (
          <div className="rounded-xl bg-secondary px-3 py-2.5">
            <p className="text-[11px] text-muted">Channel link to connect</p>
            <p className="text-xs font-semibold text-primary truncate">{link.trim()}</p>
          </div>
        )}

        {isFinalStep && submitError && (
          <div className="flex items-start gap-2 text-left text-xs text-red-500 bg-red-50 dark:bg-red-900/20 rounded-xl p-3">
            <ShieldAlert size={14} className="mt-0.5 flex-shrink-0" />
            <span>{submitError}</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button onClick={goBack} disabled={submitting} className="btn-secondary flex-1 py-3 text-sm font-semibold disabled:opacity-60">
          Back
        </button>
        <button
          onClick={goNext}
          disabled={submitting || (isPasteStep && !link.trim())}
          className="btn-primary flex-1 py-3 text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60"
        >
          {submitting ? (
            <>
              <Loader2 size={15} className="animate-spin" />
              Verifying...
            </>
          ) : (
            <>
              Next
              <ArrowRight size={15} />
            </>
          )}
        </button>
      </div>

      <div className="flex items-start gap-2 text-left text-[11px] text-muted">
        <ShieldCheck size={13} className="mt-0.5 flex-shrink-0" />
        <span>Onfile only requests permission for the bot to post messages in your private channel — nothing more.</span>
      </div>
    </div>
  );
}
