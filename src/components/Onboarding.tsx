"use client";
import React, { useState } from "react";
import { cn } from "@/lib/utils";

const SLIDES = [
  {
    emoji: "📁",
    title: "Share Files Seamlessly",
    description: "Connect your Telegram channel or paste message links to instantly publish and monetize your files with smart links.",
    bg: "from-orange-500/20 to-amber-500/10",
  },
  {
    emoji: "💰",
    title: "Earn from Every Download",
    description: "Set Telegram Stars prices, add password protection, or let users watch ads. You earn every time someone accesses your content.",
    bg: "from-purple-500/10 to-pink-500/10",
  },
  {
    emoji: "🔗",
    title: "Smart Links & Playlists",
    description: "Organize content into beautiful playlists, create smart links, and track real-time analytics on every file.",
    bg: "from-blue-500/10 to-cyan-500/10",
  },
  {
    emoji: "🚀",
    title: "Referral & Ad Revenue",
    description: "Invite creators and earn 5% commission lifetime. Monetize further with integrated Adsgram, Adsonar, and Monitag ad units.",
    bg: "from-green-500/10 to-emerald-500/10",
  },
];

interface OnboardingProps {
  onComplete: () => void;
}

export default function Onboarding({ onComplete }: OnboardingProps) {
  const [current, setCurrent] = useState(0);
  const isLast = current === SLIDES.length - 1;

  const next = () => {
    if (isLast) {
      onComplete();
    } else {
      setCurrent((p) => p + 1);
    }
  };

  const skip = () => onComplete();

  const slide = SLIDES[current];

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-app px-6 py-10">
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-20 left-10 w-32 h-32 rounded-full bg-brand/5 blur-3xl" />
        <div className="absolute bottom-20 right-10 w-32 h-32 rounded-full bg-brand/5 blur-3xl" />
      </div>

      {/* Logo */}
      <div className="mb-10 flex flex-col items-center gap-2">
        <div className="w-14 h-14 rounded-2xl gradient-brand flex items-center justify-center text-white text-2xl font-black shadow-lg"
          style={{ boxShadow: "0 8px 30px rgba(255,97,21,0.4)" }}>
          O
        </div>
        <h1 className="text-lg font-black text-primary tracking-tight">Onfile</h1>
      </div>

      {/* Card */}
      <div
        className={cn(
          "w-full max-w-sm bg-card rounded-3xl border border-app shadow-app-lg p-8 flex flex-col items-center text-center gap-5 relative overflow-hidden animate-scale-in"
        )}
        key={current}
      >
        {/* BG gradient */}
        <div className={cn("absolute inset-0 bg-gradient-to-br opacity-50 pointer-events-none", slide.bg)} />

        {/* Emoji Art */}
        <div className="relative z-10 w-28 h-28 rounded-3xl bg-gradient-to-br from-brand/20 to-brand/5 border border-brand/20 flex items-center justify-center text-6xl">
          {slide.emoji}
        </div>

        <div className="relative z-10">
          <h2 className="text-xl font-black text-primary mb-2 leading-snug">{slide.title}</h2>
          <p className="text-sm text-secondary leading-relaxed">{slide.description}</p>
        </div>

        {/* Dots */}
        <div className="flex items-center gap-2 relative z-10">
          {SLIDES.map((_, i) => (
            <button
              key={i}
              onClick={() => setCurrent(i)}
              className={cn(
                "rounded-full transition-all",
                i === current
                  ? "w-6 h-2 bg-brand"
                  : "w-2 h-2 bg-border-app hover:bg-brand/40"
              )}
              style={{ backgroundColor: i === current ? "#FF6115" : "var(--color-border)" }}
            />
          ))}
        </div>
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between w-full max-w-sm mt-6">
        <button
          onClick={skip}
          className="px-5 py-2.5 text-sm font-medium text-secondary hover:text-primary transition-colors"
        >
          SKIP
        </button>
        <button
          onClick={next}
          className="btn-primary px-8 py-3 text-sm"
        >
          {isLast ? "GET STARTED" : "NEXT"}
        </button>
      </div>
    </div>
  );
}
