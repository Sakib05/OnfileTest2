"use client";
import React, { useState } from "react";
import { CalendarRange } from "lucide-react";
import { cn } from "@/lib/utils";
import { MIN_CUSTOM_DATE, isValidDateString, type RangeKey } from "@/lib/playlistAnalyticsRange";
import type { RangeSelection } from "./types";

const PRESETS: { key: Exclude<RangeKey, "custom">; label: string }[] = [
  { key: "7d", label: "Last 7 Days" },
  { key: "30d", label: "Last 30 Days" },
  { key: "90d", label: "Last 90 Days" },
  { key: "all", label: "All Time" },
];

const chip =
  "min-h-10 px-3 rounded-full border text-xs font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)] disabled:opacity-60";

/**
 * Date range filter: four presets + a Custom range. The chips wrap onto several lines on a narrow phone instead of
 * scrolling sideways. Custom dates are plain <input type="date"> (native pickers on Android/iOS), limited to
 * [MIN_CUSTOM_DATE, today] so a future date can't be chosen; the server re-validates everything.
 */
export default function RangePicker({
  value,
  today,
  busy,
  onChange,
}: {
  value: RangeSelection;
  /** Today in the viewer's timezone (YYYY-MM-DD) — the latest selectable date. */
  today: string;
  busy: boolean;
  onChange: (next: RangeSelection) => void;
}) {
  const [customOpen, setCustomOpen] = useState(value.key === "custom");
  const [from, setFrom] = useState(value.from ?? "");
  const [to, setTo] = useState(value.to ?? "");
  const [error, setError] = useState("");

  const apply = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidDateString(from) || !isValidDateString(to)) return setError("Choose both a start and an end date.");
    if (from > to) return setError("The start date must be on or before the end date.");
    if (from > today) return setError("The start date can't be in the future.");
    if (from < MIN_CUSTOM_DATE) return setError("The start date is too far in the past.");
    setError("");
    onChange({ key: "custom", from, to: to > today ? today : to });
  };

  return (
    <div className="flex flex-col gap-3" data-testid="range-picker">
      <div role="group" aria-label="Date range" className="flex flex-wrap gap-2">
        {PRESETS.map((p) => {
          const active = value.key === p.key;
          return (
            <button
              key={p.key}
              type="button"
              aria-pressed={active}
              disabled={busy && active}
              data-testid={`range-${p.key}`}
              onClick={() => {
                setCustomOpen(false);
                setError("");
                if (!active) onChange({ key: p.key });
              }}
              className={cn(chip, active ? "bg-[var(--color-primary)] border-transparent text-white" : "bg-secondary border-app text-primary hover:bg-card")}
            >
              {p.label}
            </button>
          );
        })}
        <button
          type="button"
          aria-pressed={value.key === "custom"}
          aria-expanded={customOpen}
          aria-controls="analytics-custom-range"
          data-testid="range-custom"
          onClick={() => setCustomOpen((o) => !o)}
          className={cn(chip, value.key === "custom" ? "bg-[var(--color-primary)] border-transparent text-white" : "bg-secondary border-app text-primary hover:bg-card")}
        >
          <CalendarRange size={14} aria-hidden="true" /> Custom
        </button>
      </div>

      {customOpen && (
        <form id="analytics-custom-range" noValidate onSubmit={apply} className="rounded-2xl border border-app bg-card p-3 flex flex-col gap-3" data-testid="custom-range-form">
          <div className="grid grid-cols-1 min-[380px]:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs font-medium text-secondary min-w-0">
              Start date
              <input
                type="date"
                className="input-app text-sm min-w-0 w-full"
                value={from}
                min={MIN_CUSTOM_DATE}
                max={today}
                onChange={(e) => setFrom(e.target.value)}
                data-testid="custom-from"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-secondary min-w-0">
              End date
              <input
                type="date"
                className="input-app text-sm min-w-0 w-full"
                value={to}
                min={from || MIN_CUSTOM_DATE}
                max={today}
                onChange={(e) => setTo(e.target.value)}
                data-testid="custom-to"
              />
            </label>
          </div>
          {error && (
            <p role="alert" className="text-xs text-red-600 dark:text-red-400" data-testid="custom-range-error">
              {error}
            </p>
          )}
          <button type="submit" disabled={busy} className="btn-primary min-h-11 text-sm px-5 py-2.5 self-start" data-testid="custom-apply">
            Apply range
          </button>
        </form>
      )}
    </div>
  );
}
