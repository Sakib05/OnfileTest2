"use client";
import React, { useRef } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface PerformancePoint {
  label: string;
  views: number;
  downloads: number;
  earnings: number;
}

type InputModality = "pointer" | "keyboard";

/**
 * The Dashboard "Performance" chart.
 *
 * Why a border used to appear after tapping it: Recharts 3 turns its
 * `accessibilityLayer` on by default, which makes the chart's <svg> focusable
 * (`tabindex="0"`, `role="application"`). A click/tap therefore FOCUSES the svg
 * and the browser / Telegram WebView paints its default focus ring around the
 * whole chart (and Android adds a tap-highlight rectangle on top).
 *
 * The accessibility layer is kept (so keyboard users can still focus the chart
 * and step through the data points). Only the *pointer-originated* ring is
 * suppressed: the wrapper records whether the last interaction was a pointer
 * or a key press (`data-input`), and globals.css hides the outline only while
 * it is "pointer". Pressing any key flips it back, so a keyboard user still
 * sees the normal focus indicator. Tooltips, hover and touch behaviour are
 * untouched — this only changes `outline` / tap-highlight.
 */
export default function PerformanceChart({ data }: { data: PerformancePoint[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const setModality = (m: InputModality) => () => {
    if (ref.current && ref.current.dataset.input !== m) ref.current.dataset.input = m;
  };
  const pointer = setModality("pointer");

  return (
    <div
      ref={ref}
      className="perf-chart"
      data-testid="performance-chart"
      data-input="keyboard"
      onPointerDownCapture={pointer}
      onMouseDownCapture={pointer}
      onTouchStartCapture={pointer}
      onKeyDownCapture={setModality("keyboard")}
    >
      <ResponsiveContainer width="100%" height={160}>
        <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
          <defs>
            <linearGradient id="viewsGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#FF6115" stopOpacity={0.25} />
              <stop offset="95%" stopColor="#FF6115" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="dlGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#22c55e" stopOpacity={0.25} />
              <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--color-text-muted)" }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 10, fill: "var(--color-text-muted)" }} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={{
              background: "var(--color-bg-card)",
              border: "1px solid var(--color-border)",
              borderRadius: 12,
              fontSize: 12,
              color: "var(--color-text)",
            }}
          />
          <Area type="monotone" dataKey="views" name="Views" stroke="#FF6115" fill="url(#viewsGrad)" strokeWidth={2} dot={false} />
          <Area type="monotone" dataKey="downloads" name="Downloads" stroke="#22c55e" fill="url(#dlGrad)" strokeWidth={2} dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
