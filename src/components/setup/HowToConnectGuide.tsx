"use client";
import React from "react";
import { ArrowLeft, Bot, CheckCircle2, MousePointerClick, PlayCircle, ShieldCheck, Timer, Rocket } from "lucide-react";

interface GuideStep {
  icon: React.FC<{ size: number; className?: string }>;
  title: string;
  description: string;
}

const STEPS: GuideStep[] = [
  {
    icon: Bot,
    title: "Start the connection",
    description: 'Tap "Connect channel via bot" on the Channel Connect screen.',
  },
  {
    icon: PlayCircle,
    title: "Read the instructions",
    description: 'Review the illustrated instructions and tap "Connect Channel".',
  },
  {
    icon: MousePointerClick,
    title: "Select a private channel",
    description: "Use Telegram's own chat/channel selector to choose an eligible private channel you administer.",
  },
  {
    icon: ShieldCheck,
    title: "Approve the required permissions",
    description: "Review the permissions Telegram requests for the Onfile bot and approve them if you agree.",
  },
  {
    icon: Timer,
    title: "Wait for verification",
    description: "Onfile checks the channel and the bot's access on our backend — this only takes a moment.",
  },
  {
    icon: Rocket,
    title: "Continue to Onfile",
    description: "Once verified, you'll see a confirmation screen and can continue into the app.",
  },
];

export default function HowToConnectGuide({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex flex-col gap-5 w-full max-w-sm animate-fade-in">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center flex-shrink-0">
          <ArrowLeft size={16} style={{ color: "var(--color-text)" }} />
        </button>
        <h1 className="text-lg font-bold text-primary">How to connect?</h1>
      </div>

      <p className="text-sm text-secondary leading-relaxed">
        Here&apos;s exactly what happens when you connect a private Telegram channel to Onfile using the bot.
      </p>

      <div className="flex flex-col gap-3">
        {STEPS.map((step, idx) => (
          <div key={step.title} className="bg-card rounded-2xl border border-app shadow-app-sm p-4 flex items-start gap-3">
            <div className="w-8 h-8 rounded-full gradient-brand text-white text-xs font-bold flex items-center justify-center flex-shrink-0">
              {idx + 1}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <step.icon size={14} className="text-brand" />
                <p className="text-sm font-semibold text-primary">{step.title}</p>
              </div>
              <p className="text-xs text-secondary mt-1 leading-relaxed">{step.description}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-start gap-2 text-left text-xs text-secondary bg-secondary rounded-xl p-3">
        <CheckCircle2 size={14} className="mt-0.5 flex-shrink-0 text-brand" />
        <span>Onfile only ever shows you Telegram&apos;s own native screens for selecting a chat and approving bot permissions — nothing is simulated.</span>
      </div>

      <button onClick={onBack} className="btn-primary w-full py-3.5 text-sm font-semibold">
        Back to Channel Connect
      </button>
    </div>
  );
}
