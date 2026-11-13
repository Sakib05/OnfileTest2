"use client";
import React, { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
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
import { INVITE_LINK_FAILURE_MESSAGES, validatePrivateInviteLink } from "@/lib/inviteLink";
import { cn } from "@/lib/utils";
import GuideIllustration from "@/components/setup/guide/GuideIllustrations";
import { useTelegramBackButton } from "@/lib/useTelegramBackButton";

interface GuideStep {
  icon: React.FC<{ size: number; className?: string }>;
  title: string;
  description: string;
  /** Optional extra hint shown under the description. */
  hint?: string;
}

/**
 * The eight Manual Connect steps, in their required order. Each step has its
 * own recreated screenshot in ./guide/GuideIllustrations.tsx (same index).
 *
 * Step 5 mirrors the backend exactly: REQUIRED_BOT_ADMIN_RIGHTS in
 * src/lib/telegramBot.ts only requires `can_post_messages`; every other
 * administrator right is requested as `false`.
 */
const GUIDE_STEPS: GuideStep[] = [
  {
    icon: MessageSquareText,
    title: "Open Your Telegram Channel",
    description: "Open the private Telegram channel you want to connect to Onfile.",
  },
  {
    icon: Settings,
    title: "Open Channel Settings",
    description: "Tap the channel name and open Edit or Manage Channel.",
    hint: "On Android, Edit appears as a pencil icon (\u270F) on the channel info screen.",
  },
  {
    icon: Users,
    title: "Open Administrators",
    description: "Go to the Administrators section.",
  },
  {
    icon: UserPlus,
    title: "Add Onfile Bot",
    description: "Find the official Onfile Bot and add it as an administrator.",
  },
  {
    icon: Sliders,
    title: "Grant Required Permissions",
    description: "Enable only the administrator permissions required by Onfile and confirm.",
    hint: "Required: Post Messages. Leave every other permission off.",
  },
  {
    icon: Link2,
    title: "Copy Your Channel Link",
    description: "Copy the private invite link of your Telegram channel.",
    hint: "It looks like t.me/+AbCdEfGh\u2026 (or t.me/joinchat/AbCdEfGh\u2026) \u2014 not a public @username link.",
  },
  {
    icon: ClipboardPaste,
    title: "Paste Link in Onfile",
    description: "Return to Onfile and paste the copied private channel link into the Manual Connect input field.",
  },
  {
    icon: ShieldCheck,
    title: "Click Next to Continue",
    description: "Tap the Next button below to continue to the next step.",
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
  const currentRowRef = useRef<HTMLLIElement | null>(null);
  const hasNavigatedRef = useRef(false);

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

  // Keep the active step in view when the user navigates (not on first paint).
  useEffect(() => {
    if (!hasNavigatedRef.current) {
      hasNavigatedRef.current = true;
      return;
    }
    currentRowRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }, [stepIndex]);

  const totalSteps = GUIDE_STEPS.length; // 8
  const isPasteStep = stepIndex === 6; // Step 7 (0-indexed 6): "Paste Link in Onfile"
  const isFinalStep = stepIndex === 7; // Step 8 (0-indexed 7): "Click Next to Continue"

  const stepData = GUIDE_STEPS[stepIndex];

  /**
   * Three DIFFERENT navigation actions live on this screen — keep them separate:
   *   - bottom Back  → previous guide step (`goToPreviousStep`; never leaves the guide)
   *   - bottom Next  → next guide step (`goNext`; never leaves the guide)
   *   - Telegram's native Back Button (and the in-page header arrow, its
   *     non-Telegram equivalent) → leave the WHOLE guide and return to the
   *     previous application page (`exitGuide`), regardless of the current step.
   */
  const goToPreviousStep = () => {
    if (submitting || stepIndex === 0) return;
    setStepIndex((i) => i - 1);
  };

  const exitGuide = () => {
    if (submitting) return;
    onBack();
  };

  // Native Back Button = exit the guide page (registered through the shared manager: one listener).
  useTelegramBackButton(exitGuide);

  const submitManualLink = async () => {
    if (submitting) return; // guard against duplicate submissions
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/channels/connect-manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteLink: link.trim() }),
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

  /** Completed steps can be re-opened directly; future steps stay locked. */
  const jumpToCompleted = (idx: number) => {
    if (submitting || idx >= stepIndex) return;
    setStepIndex(idx);
  };

  const goNext = () => {
    if (submitting) return;
    if (isPasteStep) {
      const validation = validatePrivateInviteLink(link);
      if (!validation.ok) {
        setLinkError(INVITE_LINK_FAILURE_MESSAGES[validation.reason]);
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

  const progressPercent = Math.round((stepIndex / totalSteps) * 100);

  const linkInput = (
    <input
      className="input-app text-sm"
      placeholder="https://t.me/+AbCdEfGhIjKlMnOp"
      aria-label="Private channel link"
      value={link}
      onChange={(e) => {
        setLink(e.target.value);
        if (linkError) setLinkError(null);
      }}
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
    />
  );

  return (
    <div className="flex flex-col gap-4 w-full max-w-sm animate-fade-in">
      <div className="flex items-center gap-3">
        <button
          onClick={exitGuide}
          aria-label="Exit guide"
          className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center flex-shrink-0"
        >
          <ArrowLeft size={16} style={{ color: "var(--color-text)" }} />
        </button>
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-primary">Manual Connect Guide</h1>
          <p className="text-xs text-secondary">
            Step {stepIndex + 1} of {totalSteps}
          </p>
        </div>
      </div>

      {/* Progress indicator */}
      <div
        className="flex items-center gap-1.5"
        role="progressbar"
        aria-label="Guide progress"
        aria-valuemin={0}
        aria-valuemax={totalSteps}
        aria-valuenow={stepIndex + 1}
        aria-valuetext={`Step ${stepIndex + 1} of ${totalSteps}`}
      >
        {GUIDE_STEPS.map((_, idx) => (
          <div
            key={idx}
            className={cn("h-1.5 flex-1 rounded-full transition-colors", idx <= stepIndex ? "gradient-brand" : "bg-secondary")}
          />
        ))}
      </div>
      <p className="-mt-2 text-[11px] text-muted">{progressPercent}% complete</p>

      {/* Vertical step list: completed (check) · current (expanded with screenshot) · upcoming */}
      <ol className="flex flex-col">
        {GUIDE_STEPS.map((step, idx) => {
          const isCurrent = idx === stepIndex;
          const isDone = idx < stepIndex;
          const isLast = idx === totalSteps - 1;
          const StepIcon = step.icon;

          return (
            <li
              key={step.title}
              ref={isCurrent ? currentRowRef : undefined}
              aria-current={isCurrent ? "step" : undefined}
              className="flex gap-3 scroll-mt-3"
            >
              {/* Number rail */}
              <div className="flex flex-col items-center">
                <div
                  className={cn(
                    "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors",
                    isCurrent && "gradient-brand text-white shadow-app-md",
                    isDone && "bg-brand-20 text-brand",
                    !isCurrent && !isDone && "border border-app bg-secondary text-muted",
                  )}
                >
                  {isDone ? <Check size={14} strokeWidth={3} aria-label="Completed" /> : idx + 1}
                </div>
                {!isLast && (
                  <div
                    className="my-1 w-0.5 flex-1 min-h-3 rounded-full"
                    style={{ background: isDone ? "rgba(255, 97, 21, 0.35)" : "var(--color-border)" }}
                  />
                )}
              </div>

              {/* Step body */}
              <div className={cn("min-w-0 flex-1", !isLast && (isCurrent ? "pb-4" : "pb-2"))}>
                {isCurrent ? (
                  <div className="bg-card rounded-2xl border border-brand shadow-app-sm p-3.5 flex flex-col gap-3 animate-fade-in">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <StepIcon size={14} className="text-brand flex-shrink-0" />
                        <h2 className="text-sm font-semibold text-primary">{step.title}</h2>
                      </div>
                      <p className="text-xs text-secondary mt-1 leading-relaxed">{step.description}</p>
                      {idx === 3 && botUsername && (
                        <p className="mt-1.5 text-xs text-primary">
                          Search for <span className="font-semibold text-brand break-all">@{botUsername}</span>
                        </p>
                      )}
                      {step.hint && <p className="text-[11px] text-muted mt-1.5 leading-relaxed">{step.hint}</p>}
                    </div>

                    <div className="rounded-xl border border-app bg-secondary p-3">
                      <GuideIllustration step={idx} botUsername={botUsername} link={link} linkInput={linkInput} />
                    </div>

                    {isPasteStep && linkError && (
                      <div className="flex items-start gap-1.5 text-[11px] text-red-500">
                        <ShieldAlert size={12} className="mt-0.5 flex-shrink-0" />
                        <span>{linkError}</span>
                      </div>
                    )}

                    {isFinalStep && link.trim() && (
                      <div className="rounded-xl bg-secondary px-3 py-2.5 min-w-0">
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
                ) : isDone ? (
                  <button
                    type="button"
                    onClick={() => jumpToCompleted(idx)}
                    disabled={submitting}
                    className="flex w-full min-h-8 items-center gap-1.5 text-left disabled:opacity-60"
                  >
                    <span className="truncate text-sm font-medium text-secondary">{step.title}</span>
                    <span className="ml-auto flex-shrink-0 text-[10px] font-semibold text-brand">Done</span>
                  </button>
                ) : (
                  <div className="flex min-h-8 items-center">
                    <span className="truncate text-sm font-medium text-muted">{step.title}</span>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {/* Back / Next — Next on step 8 runs the real /api/channels/connect-manual verification */}
      <div className="sticky bottom-0 -mx-1 flex items-center gap-3 bg-app px-1 pt-2 pb-3 safe-bottom">
        <button
          onClick={goToPreviousStep}
          disabled={submitting || stepIndex === 0}
          className="btn-secondary flex-1 py-3 text-sm font-semibold disabled:opacity-60"
        >
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
