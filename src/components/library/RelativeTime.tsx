"use client";
import React, { useSyncExternalStore } from "react";
import { formatAbsoluteDate, formatRelativeTime, parseTimestamp } from "@/lib/relativeTime";

// One shared clock for every card (a single interval, not one per card). It ticks once a
// minute so "Just now" / "5 minutes ago" don't go stale while the Library stays open.
let clock = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(cb: () => void) {
  // A card mounting long after the last tick must not show a stale "now": React re-reads the
  // snapshot right after subscribing and re-renders if it changed.
  clock = Date.now();
  listeners.add(cb);
  if (!timer) {
    timer = setInterval(() => {
      clock = Date.now();
      listeners.forEach((l) => l());
    }, 60_000);
  }
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}
const getSnapshot = () => clock;

/**
 * Subtle "uploaded 2 hours ago" label from an already-fetched `createdAt`.
 * Renders nothing when the timestamp is missing/invalid (no invented date).
 */
export default function RelativeTime({ value, className }: { value: string | Date | null | undefined; className?: string }) {
  const now = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const label = formatRelativeTime(value, now);
  if (!label) return null;
  const t = parseTimestamp(value)!;
  return (
    <time dateTime={new Date(t).toISOString()} title={formatAbsoluteDate(value) ?? undefined} data-testid="relative-time" className={className} suppressHydrationWarning>
      {label}
    </time>
  );
}
