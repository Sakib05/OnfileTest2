"use client";
import React, { useState } from "react";
import { cn } from "@/lib/utils";

interface TitleFragment {
  text: string;
  highlight?: boolean;
}

interface Slide {
  image: string;
  imageAlt: string;
  title: TitleFragment[];
  description: string;
}

// NOTE: Onboarding always renders on a light, warm cream background with
// hard-coded colors (not the `--color-bg` / `.dark` theme variables used by
// the rest of the app). This is intentional: Telegram's client can launch
// Mini Apps with a dark color scheme preference, which flips the app's
// global `.dark` class and would otherwise turn this screen black. The
// onboarding experience must always look the same regardless of theme, so
// it intentionally does not read from ThemeContext / CSS theme variables.
const SLIDES: Slide[] = [
  {
    image: "/images/onboarding/onboarding-share.png",
    imageAlt: "Share Telegram files with a simple link",
    title: [
      { text: "Share Files Seamlessly & " },
      { text: "Earn from Every Download", highlight: true },
    ],
    description:
      "Share your Telegram files with a simple link. No need to upload them to another platform. And get rewarded when people download your files.",
  },
  {
    image: "/images/onboarding/onboarding-monetize.png",
    imageAlt: "Monetize your files from day one",
    title: [{ text: "Monetize " }, { text: "from Day One", highlight: true }],
    description:
      "Start sharing your files and unlock monetization opportunities from the beginning, subject to our monetization policies.",
  },
  {
    image: "/images/onboarding/onboarding-channel.png",
    imageAlt: "Connect your private Telegram channel",
    title: [{ text: "Your Channel, " }, { text: "Your Control", highlight: true }],
    description:
      "Connect your private Telegram channel to manage file delivery and track your performance.",
  },
];

interface OnboardingProps {
  onComplete: () => void;
}

export default function Onboarding({ onComplete }: OnboardingProps) {
  const [current, setCurrent] = useState(0);
  const isLast = current === SLIDES.length - 1;
  const slide = SLIDES[current];

  const next = () => {
    if (isLast) {
      onComplete();
    } else {
      setCurrent((p) => p + 1);
    }
  };

  const skip = () => onComplete();

  return (
    <div
      className="relative flex min-h-[100dvh] w-full flex-col overflow-hidden"
      style={{ backgroundColor: "#FFFCF4" }}
    >
      {/* Subtle warm decorative accents */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute -top-16 -right-10 h-56 w-56 rounded-full blur-3xl"
          style={{ backgroundColor: "rgba(255, 97, 21, 0.10)" }}
        />
        <div
          className="absolute bottom-24 -left-16 h-64 w-64 rounded-full blur-3xl"
          style={{ backgroundColor: "rgba(255, 97, 21, 0.08)" }}
        />
      </div>

      {/* Header: logo only (no duplicate wordmark) + Skip */}
      <div
        className="relative z-10 flex shrink-0 items-center justify-between px-5"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 18px)" }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/onfile-logo.png"
          alt="Onfile"
          className="h-8 w-auto object-contain"
          draggable={false}
        />
        <button
          type="button"
          onClick={skip}
          className="text-sm font-medium transition-colors"
          style={{ color: "#8a8372" }}
        >
          Skip
        </button>
      </div>

      {/* Illustration — large, prominent, upper-middle area */}
      <div className="relative z-10 flex min-h-0 w-full flex-1 items-center justify-center px-8 py-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={slide.image}
          src={slide.image}
          alt={slide.imageAlt}
          className="h-full w-full max-w-sm object-contain animate-fade-in"
          draggable={false}
        />
      </div>

      {/* Title, description, pagination dots */}
      <div className="relative z-10 shrink-0 px-6 pt-2" key={`content-${current}`}>
        <h1
          className="text-left text-[28px] font-extrabold leading-[1.2] tracking-tight"
          style={{ color: "#17130f" }}
        >
          {slide.title.map((fragment, i) => (
            <span key={i} style={{ color: fragment.highlight ? "#FF6115" : "#17130f" }}>
              {fragment.text}
            </span>
          ))}
        </h1>
        <p
          className="mt-3 text-left text-[15px] leading-relaxed"
          style={{ color: "#75705f" }}
        >
          {slide.description}
        </p>

        {/* Pagination dots — exactly three, clickable, never numeric text */}
        <div className="mt-5 flex items-center gap-2">
          {SLIDES.map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Go to slide ${i + 1}`}
              aria-current={i === current}
              onClick={() => setCurrent(i)}
              className="h-2 rounded-full transition-all duration-300"
              style={{
                width: i === current ? 24 : 8,
                backgroundColor: i === current ? "#FF6115" : "#e8e1d2",
              }}
            />
          ))}
        </div>
      </div>

      {/* Bottom navigation: Skip (left) + Next / Get Started (right) */}
      <div
        className="relative z-10 mt-6 flex shrink-0 items-center justify-between px-6"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 20px)" }}
      >
        <button
          type="button"
          onClick={skip}
          className="text-sm font-semibold transition-colors"
          style={{ color: "#8a8372" }}
        >
          Skip
        </button>
        <button
          type="button"
          onClick={next}
          className={cn(
            "flex items-center gap-2 rounded-full px-7 py-3.5 text-sm font-semibold text-white transition-transform active:scale-[0.97]"
          )}
          style={{
            background: "linear-gradient(135deg, #FF6115 0%, #ff8c4a 100%)",
            boxShadow: "0 10px 24px rgba(255, 97, 21, 0.35)",
          }}
        >
          {isLast ? "Get Started" : "Next"}
          <span aria-hidden="true">→</span>
        </button>
      </div>
    </div>
  );
}
