"use client";
import React from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatBucketTitle, type Granularity } from "@/lib/playlistAnalyticsRange";
import type { AnalyticsPoint } from "./types";

export const VIEWS_COLOR = "#FF6115";
export const DOWNLOADS_COLOR = "#2f7dd1";

type TipProps = { active?: boolean; payload?: ReadonlyArray<{ payload?: AnalyticsPoint }>; granularity: Granularity };

function ChartTooltip({ active, payload, granularity }: TipProps) {
  const p = payload?.[0]?.payload;
  if (!active || !p) return null;
  return (
    <div className="rounded-xl border border-app bg-card px-3 py-2 shadow-app-sm text-xs" data-testid="chart-tooltip">
      <p className="font-semibold text-primary mb-1">{formatBucketTitle(p.date, granularity)}</p>
      <p className="flex items-center gap-2 text-secondary">
        <span className="w-2 h-2 rounded-full" style={{ background: VIEWS_COLOR }} aria-hidden="true" /> Views: <span className="font-semibold text-primary">{p.views.toLocaleString("en-US")}</span>
      </p>
      <p className="flex items-center gap-2 text-secondary">
        <span className="w-2 h-2 rounded-full" style={{ background: DOWNLOADS_COLOR }} aria-hidden="true" /> Downloads: <span className="font-semibold text-primary">{p.downloads.toLocaleString("en-US")}</span>
      </p>
    </div>
  );
}

/**
 * Views + Downloads over time: two series that share ONE count axis (both are plain counts). Earnings are never drawn
 * here — they use a different unit and are shown separately. Data comes gap-free from the server (a day without events
 * is a zero point, not a missing one). Uses the project's existing recharts dependency.
 *
 * Pointer-originated focus rings are suppressed the same way as the dashboard chart (see PerformanceChart): the wrapper
 * tracks pointer vs keyboard input and globals.css hides the outline only for pointer input.
 */
export default function ViewsDownloadsChart({ data, granularity }: { data: AnalyticsPoint[]; granularity: Granularity }) {
  const setModality = (m: "pointer" | "keyboard") => (e: React.SyntheticEvent<HTMLDivElement>) => {
    e.currentTarget.dataset.input = m;
  };
  const dots = data.length <= 31;

  return (
    <div>
      <ul className="flex items-center gap-4 mb-3 text-xs text-secondary" aria-label="Chart legend" data-testid="chart-legend">
        <li className="inline-flex items-center gap-1.5">
          <span className="w-3 h-1 rounded-full" style={{ background: VIEWS_COLOR }} aria-hidden="true" /> Views
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span className="w-3 h-1 rounded-full" style={{ background: DOWNLOADS_COLOR }} aria-hidden="true" /> Downloads
        </li>
      </ul>
      <div
        data-input="keyboard"
        data-testid="views-downloads-chart"
        className="perf-chart w-full h-56 sm:h-64"
        onPointerDown={setModality("pointer")}
        onKeyDown={setModality("keyboard")}
        role="group"
        aria-label={`Line chart of views and downloads, ${data.length} ${granularity === "day" ? "days" : granularity === "week" ? "weeks" : "months"}`}
      >
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -12 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--color-text-muted)" }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={28} />
            <YAxis tick={{ fontSize: 10, fill: "var(--color-text-muted)" }} axisLine={false} tickLine={false} allowDecimals={false} width={40} />
            <Tooltip content={<ChartTooltip granularity={granularity} />} cursor={{ stroke: "var(--color-border)" }} />
            <Line type="monotone" dataKey="views" name="Views" stroke={VIEWS_COLOR} strokeWidth={2} dot={dots ? { r: 2 } : false} activeDot={{ r: 4 }} isAnimationActive={false} />
            <Line type="monotone" dataKey="downloads" name="Downloads" stroke={DOWNLOADS_COLOR} strokeWidth={2} dot={dots ? { r: 2 } : false} activeDot={{ r: 4 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
