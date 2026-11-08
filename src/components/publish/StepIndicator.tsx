"use client";
import React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { STEP_LABELS, type StepIndex } from "./draft";

/**
 * Four-step progress indicator. Completed steps are tappable so creators can
 * go back and edit; later steps are not reachable by tapping.
 */
export default function StepIndicator({
  current,
  maxReached,
  onSelect,
}: {
  current: StepIndex;
  maxReached: StepIndex;
  onSelect: (s: StepIndex) => void;
}) {
  return (
    <nav aria-label="Publishing progress" className="w-full">
      <ol className="flex items-start">
        {STEP_LABELS.map((label, i) => {
          const done = i < current;
          const active = i === current;
          const reachable = i <= maxReached && i !== current;
          return (
            <li key={label} className={cn("flex items-start", i < STEP_LABELS.length - 1 && "flex-1")}>
              <button
                type="button"
                disabled={!reachable}
                onClick={() => onSelect(i as StepIndex)}
                aria-current={active ? "step" : undefined}
                aria-label={`Step ${i + 1}: ${label}${done ? " (completed)" : active ? " (current)" : ""}`}
                className={cn(
                  "flex flex-col items-center gap-1.5 min-w-[56px] min-h-11 disabled:cursor-default",
                  reachable && "cursor-pointer"
                )}
              >
                <span
                  className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all duration-300",
                    active && "gradient-brand text-white border-transparent scale-110 shadow-lg",
                    done && "bg-brand-20 border-brand text-brand",
                    !active && !done && "bg-secondary border-app text-muted"
                  )}
                  style={active ? { boxShadow: "0 4px 14px rgba(255,97,21,0.4)" } : undefined}
                >
                  {done ? <Check size={14} strokeWidth={3} /> : i + 1}
                </span>
                <span className={cn("text-[11px] font-medium leading-none", active ? "text-primary" : "text-secondary")}>
                  {label}
                </span>
              </button>
              {i < STEP_LABELS.length - 1 && (
                <span aria-hidden="true" className="flex-1 h-0.5 mt-4 mx-1 rounded-full bg-secondary overflow-hidden">
                  <span
                    className="block h-full gradient-brand transition-all duration-500"
                    style={{ width: i < current ? "100%" : "0%" }}
                  />
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
