"use client";
import React, { useState } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, Gift, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { STARS_MAX, STARS_MIN, type Monetization } from "@/lib/publishing/constants";
import { validateMonetization, type FieldErrors } from "@/lib/publishing/validation";
import { PAID_PUBLISHING_UNAVAILABLE_MESSAGE } from "@/lib/publishing/payments";
import type { PublishDraft } from "./draft";

const OPTIONS: { value: Monetization; title: string; blurb: string; icon: React.ReactNode }[] = [
  { value: "free", title: "Free Content", blurb: "Anyone with the link can access it.", icon: <Gift size={20} /> },
  { value: "paid", title: "Paid Content", blurb: "Viewers pay Telegram Stars to unlock it.", icon: <Star size={20} /> },
];

export default function MonetizationStep({
  draft,
  onChange,
  paidPublishingAvailable,
  onBack,
  onContinue,
  serverErrors,
}: {
  draft: PublishDraft;
  onChange: (patch: Partial<PublishDraft>) => void;
  /** null while still loading capabilities */
  paidPublishingAvailable: boolean | null;
  onBack: () => void;
  onContinue: () => void;
  serverErrors?: FieldErrors;
}) {
  const [submitted, setSubmitted] = useState(false);
  const clientErrors = validateMonetization(draft.monetization, draft.starsPrice);
  const priceError = (submitted ? clientErrors.starsPrice : undefined) ?? serverErrors?.starsPrice;
  const priceNum = Number(draft.starsPrice);

  const next = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (Object.keys(clientErrors).length === 0) onContinue();
  };

  return (
    <form onSubmit={next} className="flex flex-col gap-4" noValidate>
      <div>
        <h2 className="text-xl font-bold text-primary">Monetization</h2>
        <p className="text-sm text-secondary mt-1">Optional. Choose whether this post is free or paid.</p>
      </div>

      <div role="radiogroup" aria-label="Content access" className="grid grid-cols-2 gap-3">
        {OPTIONS.map((o) => {
          const selected = draft.monetization === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange({ monetization: o.value })}
              className={cn(
                "text-left rounded-2xl p-4 border-2 transition-all min-h-[120px] flex flex-col gap-2",
                selected ? "border-brand bg-brand-10 shadow-app-md" : "border-app bg-card"
              )}
            >
              <span className={cn("w-10 h-10 rounded-xl flex items-center justify-center", selected ? "gradient-brand text-white" : "bg-secondary text-secondary")}>
                {o.icon}
              </span>
              <span className="text-sm font-bold text-primary">{o.title}</span>
              <span className="text-xs text-secondary leading-snug">{o.blurb}</span>
            </button>
          );
        })}
      </div>

      {draft.monetization === "paid" && (
        <section className="bg-card rounded-2xl border border-app shadow-app-sm p-4 flex flex-col gap-3 animate-slide-up">
          <label htmlFor="stars-price" className="text-xs font-semibold text-secondary flex items-center gap-1.5">
            <Star size={12} className="text-yellow-500" />
            Price in Telegram Stars
          </label>
          <div className="relative">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-base" aria-hidden="true">
              ⭐
            </span>
            <input
              id="stars-price"
              className={cn("input-app text-base min-h-12 pl-10", priceError && "!border-red-500")}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder={`${STARS_MIN} – ${STARS_MAX.toLocaleString("en-US")}`}
              value={draft.starsPrice}
              onChange={(e) => onChange({ starsPrice: e.target.value.replace(/[^0-9]/g, "").slice(0, 6) })}
              aria-invalid={!!priceError}
              aria-describedby="stars-help"
            />
          </div>
          {priceError && (
            <p role="alert" className="text-xs text-red-500">
              {priceError}
            </p>
          )}
          <p id="stars-help" className="text-xs text-secondary">
            Viewers will need to pay {Number.isFinite(priceNum) && priceNum > 0 ? `${priceNum.toLocaleString("en-US")} ` : "this amount of "}
            Stars to access this content.
          </p>

          {paidPublishingAvailable !== true && (
            <div className="flex items-start gap-2.5 rounded-xl p-3 bg-yellow-500/10 border border-yellow-500/30" role="note">
              <AlertTriangle size={16} className="text-yellow-600 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-secondary">
                {paidPublishingAvailable === null ? "Checking payment availability…" : PAID_PUBLISHING_UNAVAILABLE_MESSAGE}
              </p>
            </div>
          )}
        </section>
      )}

      <div className="flex gap-3 pt-1">
        <button type="button" onClick={onBack} className="btn-secondary min-h-12 flex items-center justify-center gap-1.5 text-sm font-semibold !px-5">
          <ArrowLeft size={16} />
          Back
        </button>
        <button type="submit" className="btn-primary min-h-12 flex-1 flex items-center justify-center gap-2 text-sm font-semibold">
          Preview
          <ArrowRight size={16} />
        </button>
      </div>
    </form>
  );
}
