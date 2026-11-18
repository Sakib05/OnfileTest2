"use client";
import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, CircleDollarSign, Download, Eye, Loader2, TrendingUp } from "lucide-react";
import { useApp } from "@/contexts/AppContext";
import { useTelegramBackButton } from "@/lib/useTelegramBackButton";
import { isRunningInsideTelegram } from "@/lib/telegramWebApp";
import { formatPeriod } from "@/lib/playlistAnalyticsRange";
import { cn } from "@/lib/utils";
import RangePicker from "./RangePicker";
import ViewsDownloadsChart from "./AnalyticsCharts";
import type { AnalyticsResponse, RangeSelection } from "./types";

type Status = "loading" | "ready" | "error" | "notfound" | "badrange";

const noopSubscribe = () => () => {};
const fmt = (n: number) => n.toLocaleString("en-US");

function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Today's date in the browser's timezone — only used for the date inputs' `max` before the first response arrives. */
function localTodayString(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Creator-only analytics page for ONE playlist (route: /playlists/[id]/analytics), reached from the playlist's
 * More → Analytics. Three headline metrics (Views · Downloads · Earnings), a date-range filter, a Views+Downloads chart
 * and a separate Earnings section. All numbers are aggregated by the server, which also verifies ownership; this page
 * only renders what it is given and never computes or estimates anything.
 */
export default function PlaylistAnalyticsPage({ playlistId }: { playlistId: number }) {
  const router = useRouter();
  const { authStatus, channelStatus } = useApp();
  const authed = authStatus === "authenticated";
  const insideTelegram = useSyncExternalStore(noopSubscribe, () => isRunningInsideTelegram(), () => false);

  const [sel, setSel] = useState<RangeSelection>({ key: "30d" });
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [message, setMessage] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const requestId = useRef(0);
  const tz = useMemo(() => browserTimeZone(), []);

  const managementHref = `/playlists/${playlistId}`;
  const goBack = useCallback(() => router.push(managementHref), [router, managementHref]);
  useTelegramBackButton(goBack);

  useEffect(() => {
    if (authStatus === "guest" || authStatus === "setup_required" || channelStatus === "no_channel") router.replace("/");
  }, [authStatus, channelStatus, router]);

  useEffect(() => {
    if (!authed) return;
    const id = ++requestId.current;
    const params = new URLSearchParams({ range: sel.key, tz });
    if (sel.key === "custom" && sel.from && sel.to) {
      params.set("from", sel.from);
      params.set("to", sel.to);
    }
    // Data load: network → state (nothing to derive during render).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStatus("loading");
    (async () => {
      try {
        const res = await fetch(`/api/playlists/${playlistId}/analytics?${params}`, { cache: "no-store" });
        const body = (await res.json().catch(() => null)) as (AnalyticsResponse & { error?: string }) | null;
        if (id !== requestId.current) return; // a newer selection superseded this response
        if (res.status === 404) return setStatus("notfound");
        if (res.status === 400) {
          setMessage(body?.error ?? "That date range isn't valid.");
          return setStatus("badrange");
        }
        if (!res.ok || !body || !body.range) return setStatus("error");
        setData(body);
        setStatus("ready");
      } catch {
        if (id === requestId.current) setStatus("error");
      }
    })();
  }, [authed, playlistId, sel, tz, reloadKey]);

  const loadingFirst = (!authed || status === "loading") && !data;
  const refreshing = status === "loading" && !!data;
  const today = data?.range.today ?? localTodayString();

  const header = (
    <header className="flex items-start gap-1 mb-4">
      {insideTelegram ? (
        <span className="w-2 flex-shrink-0" aria-hidden="true" />
      ) : (
        <button
          type="button"
          onClick={goBack}
          aria-label="Back to playlist"
          data-testid="analytics-back"
          className="w-11 h-11 -ml-2 flex-shrink-0 inline-flex items-center justify-center rounded-xl text-primary hover:bg-secondary focus-visible:outline-2 focus-visible:outline-[var(--color-primary)]"
        >
          <ChevronLeft size={22} aria-hidden="true" />
        </button>
      )}
      <div className="min-w-0 flex-1 pt-0.5">
        <h1 className="text-xl font-bold text-primary leading-tight" data-testid="analytics-title">
          Playlist Analytics
        </h1>
        {data && (
          <>
            <p className="text-sm text-secondary truncate mt-0.5" data-testid="analytics-playlist-name">
              {data.playlist.title}
            </p>
            <p className="text-xs text-muted mt-0.5" data-testid="analytics-period">
              {formatPeriod(data.range.from, data.range.to)}
              {data.range.granularity !== "day" && ` · grouped by ${data.range.granularity}`}
            </p>
          </>
        )}
      </div>
      {refreshing && <Loader2 size={16} className="animate-spin text-secondary mt-3 mr-1" aria-label="Updating" />}
    </header>
  );

  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen bg-app overflow-x-hidden" data-testid="analytics-page">
      <div className="max-w-2xl mx-auto w-full px-4 pt-[max(0.5rem,env(safe-area-inset-top))] pb-[calc(env(safe-area-inset-bottom)+2.5rem)]">
        {header}
        {children}
      </div>
    </div>
  );

  if (loadingFirst) {
    return shell(
      <div className="flex flex-col gap-4" role="status" aria-busy="true" aria-label="Loading analytics">
        <div className="h-10 rounded-full bg-card border border-app animate-pulse-brand" />
        <div className="grid grid-cols-1 min-[420px]:grid-cols-3 gap-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 rounded-2xl bg-card border border-app animate-pulse-brand" />
          ))}
        </div>
        <div className="h-64 rounded-2xl bg-card border border-app animate-pulse-brand" />
      </div>
    );
  }

  if (status === "notfound" && !data) {
    return shell(
      <div className="text-center py-16 px-2" data-testid="analytics-notfound">
        <p className="font-semibold text-primary mb-1">Playlist not found</p>
        <p className="text-sm text-secondary mb-5">It may have been deleted, or it isn&apos;t yours.</p>
        <button type="button" className="btn-secondary min-h-11 text-sm px-5 py-2.5" onClick={() => router.replace("/")}>
          Back to My Library
        </button>
      </div>
    );
  }

  if (status === "error" && !data) {
    return shell(
      <div className="text-center py-16 px-2" data-testid="analytics-error">
        <p className="font-semibold text-primary mb-1">Couldn&apos;t load analytics</p>
        <p className="text-sm text-secondary mb-5">Please check your connection and try again.</p>
        <button type="button" className="btn-primary min-h-11 text-sm px-5 py-2.5" onClick={() => setReloadKey((k) => k + 1)}>
          Try again
        </button>
      </div>
    );
  }

  if (!data) {
    // A rejected first range (e.g. a bad custom range) with nothing to show yet: fall back to the default range.
    return shell(
      <div className="text-center py-16 px-2" data-testid="analytics-error">
        <p className="text-sm text-secondary mb-5">{message || "Couldn't load analytics."}</p>
        <button type="button" className="btn-primary min-h-11 text-sm px-5 py-2.5" onClick={() => setSel({ key: "30d" })}>
          Show last 30 days
        </button>
      </div>
    );
  }

  const empty = data.views.total === 0 && data.downloads.total === 0;
  const { insights } = data;

  return shell(
    <div className="flex flex-col gap-5">
      <RangePicker value={sel} today={today} busy={refreshing} onChange={setSel} />

      {(status === "badrange" || status === "notfound" || status === "error") && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400 rounded-xl bg-red-50 dark:bg-red-900/20 px-3 py-2" data-testid="analytics-inline-error">
          {status === "badrange" ? message : status === "notfound" ? "This playlist is no longer available." : "Couldn't refresh the numbers. Showing the last loaded period."}
        </p>
      )}

      {/* Exactly three headline metrics */}
      <section aria-label="Key metrics" className={cn("grid grid-cols-1 min-[420px]:grid-cols-3 gap-3", refreshing && "opacity-70")} data-testid="metrics">
        <MetricCard icon={<Eye size={16} aria-hidden="true" />} label="Views" value={fmt(data.views.total)} testId="metric-views" hint={`${fmt(data.views.unique)} unique ${data.views.unique === 1 ? "viewer" : "viewers"}`} />
        <MetricCard icon={<Download size={16} aria-hidden="true" />} label="Downloads" value={fmt(data.downloads.total)} testId="metric-downloads" hint="Files opened in Telegram" />
        <MetricCard icon={<CircleDollarSign size={16} aria-hidden="true" />} label="Earnings" value="Not available" muted testId="metric-earnings" hint="Not tracked per playlist yet" />
      </section>

      <section aria-labelledby="perf-heading" className={cn("rounded-2xl border border-app bg-card p-4", refreshing && "opacity-70")} data-testid="performance-section">
        <h2 id="perf-heading" className="text-base font-bold text-primary">
          Performance overview
        </h2>
        <p className="text-xs text-secondary mb-3">Views and downloads over time</p>
        {empty ? (
          <div className="text-center py-10 px-3" data-testid="analytics-empty">
            <TrendingUp size={28} className="mx-auto text-muted mb-2" aria-hidden="true" />
            <p className="text-sm font-semibold text-primary mb-1">No activity in this period</p>
            <p className="text-sm text-secondary">Views and downloads show up here once people open this playlist&apos;s public link. Try a longer date range.</p>
          </div>
        ) : (
          <ViewsDownloadsChart data={data.series} granularity={data.range.granularity} />
        )}
      </section>

      <section aria-labelledby="earn-heading" className="rounded-2xl border border-app bg-card p-4" data-testid="earnings-section">
        <h2 id="earn-heading" className="text-base font-bold text-primary">
          Earnings overview
        </h2>
        <p className="text-xs text-secondary mb-3">Creator earnings over time</p>
        <div className="text-center py-8 px-3 rounded-xl bg-secondary" data-testid="earnings-unavailable">
          <CircleDollarSign size={26} className="mx-auto text-muted mb-2" aria-hidden="true" />
          <p className="text-sm font-semibold text-primary mb-1">Earnings aren&apos;t available for playlists yet</p>
          <p className="text-sm text-secondary">{data.earnings.message}</p>
        </div>
      </section>

      {!empty && (
        <section aria-labelledby="insights-heading" className="rounded-2xl border border-app bg-card p-4" data-testid="insights">
          <h2 id="insights-heading" className="text-base font-bold text-primary mb-3">
            Insights
          </h2>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <Insight label="Avg. daily views" value={fmt(insights.avgDailyViews)} />
            <Insight label="Avg. daily downloads" value={fmt(insights.avgDailyDownloads)} />
            {insights.bestDay && <Insight label="Best day" value={insights.bestDay.label} sub={`${fmt(insights.bestDay.views)} views · ${fmt(insights.bestDay.downloads)} downloads`} wide />}
          </dl>
          {insights.topFiles.length > 0 && (
            <div className="mt-4">
              <h3 className="text-xs font-semibold text-secondary uppercase tracking-wide mb-2">Best performing files</h3>
              <ol className="flex flex-col divide-y divide-[var(--color-border)]" data-testid="top-files">
                {insights.topFiles.map((f, i) => (
                  <li key={`${i}-${f.title}`} className="flex items-center gap-3 py-2 text-sm min-w-0">
                    <span className="w-5 text-xs text-muted flex-shrink-0">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-primary">{f.title}</span>
                    <span className="text-xs text-secondary flex-shrink-0">
                      {fmt(f.downloads)} {f.downloads === 1 ? "download" : "downloads"}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </section>
      )}

      <p className="text-xs text-muted leading-relaxed" data-testid="analytics-footnote">
        Views count each visitor once per 30 minutes and exclude you, bots and link previews. A download is counted when a visitor who unlocked a file from this
        playlist opens it in Telegram; Telegram doesn&apos;t report back whether the file was received. Dates use your timezone ({data.range.timezone}).
      </p>
    </div>
  );
}

function MetricCard({ icon, label, value, hint, testId, muted }: { icon: React.ReactNode; label: string; value: string; hint: string; testId: string; muted?: boolean }) {
  return (
    <div className="rounded-2xl border border-app bg-card p-3.5 min-w-0" data-testid={testId}>
      <p className="flex items-center gap-1.5 text-xs font-medium text-secondary">
        <span className="text-brand">{icon}</span> {label}
      </p>
      <p className={cn("mt-1.5 font-bold text-primary tabular-nums break-words", muted ? "text-base leading-7 text-secondary" : "text-2xl")} data-testid={`${testId}-value`}>
        {value}
      </p>
      <p className="text-xs text-muted mt-0.5 leading-snug">{hint}</p>
    </div>
  );
}

function Insight({ label, value, sub, wide }: { label: string; value: string; sub?: string; wide?: boolean }) {
  return (
    <div className={cn("min-w-0", wide && "col-span-2")}>
      <dt className="text-xs text-secondary">{label}</dt>
      <dd className="font-semibold text-primary break-words">{value}</dd>
      {sub && <dd className="text-xs text-muted">{sub}</dd>}
    </div>
  );
}
