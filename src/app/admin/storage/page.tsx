"use client";
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, AlertTriangle } from "lucide-react";
import { cn, formatBytes, timeAgo } from "@/lib/utils";

type Level = "ok" | "warning" | "high" | "restricted" | "full";
interface Metric {
  metric: "storage_bytes" | "bandwidth_bytes" | "requests";
  source: "manual" | "unknown";
  used: number | null;
  limit: number | null;
  percent: number | null;
  level: Level;
  updatedAt: string | null;
}
interface Status {
  configured: boolean;
  officialUsageApiAvailable: boolean;
  thresholds: { warn: number; high: number; block: number };
  overallLevel: Level;
  uploadsBlocked: boolean;
  metrics: Metric[];
  estimated: { source: "estimated"; thumbnails: number; bytes: number };
  orphanCount: number;
  failuresLast7d: number;
  recentFailures: { id: number; code: string; httpStatus: number | null; message: string | null; createdAt: string }[];
}

const LABELS: Record<Metric["metric"], string> = {
  storage_bytes: "Storage",
  bandwidth_bytes: "Bandwidth (monthly)",
  requests: "Requests (monthly)",
};
const GB = 1024 ** 3;
const LEVEL_STYLE: Record<Level, string> = {
  ok: "bg-green-100 text-green-700",
  warning: "bg-yellow-100 text-yellow-700",
  high: "bg-orange-100 text-orange-700",
  restricted: "bg-red-100 text-red-700",
  full: "bg-red-100 text-red-700",
};
const isBytes = (m: Metric["metric"]) => m !== "requests";
const fmt = (m: Metric["metric"], v: number | null) => (v === null ? "—" : isBytes(m) ? formatBytes(v) : v.toLocaleString());

export default function AdminStoragePage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [denied, setDenied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, { used: string; limit: string }>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/admin/storage", { cache: "no-store" });
      if (cancelled) return;
      if (res.status === 401 || res.status === 403) {
        setDenied(true);
      } else if (res.ok) {
        const s = (await res.json()) as Status;
        if (cancelled) return;
        setStatus(s);
        const next: Record<string, { used: string; limit: string }> = {};
        for (const m of s.metrics) {
          next[m.metric] = {
            used: m.used === null ? "" : String(isBytes(m.metric) ? +(m.used / GB).toFixed(3) : m.used),
            limit: m.limit === null ? "" : String(isBytes(m.metric) ? +(m.limit / GB).toFixed(3) : m.limit),
          };
        }
        setForm(next);
      }
      setLoading(false);
    })().catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const save = async (metric: Metric["metric"]) => {
    const f = form[metric];
    const mult = isBytes(metric) ? GB : 1;
    const res = await fetch("/api/admin/storage", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ metric, used: Number(f.used) * mult, limit: Number(f.limit) * mult }),
    });
    if (res.ok) { setStatus(await res.json()); setMsg("Saved."); } else { setMsg((await res.json().catch(() => null))?.error ?? "Could not save."); }
  };

  const retryOrphans = async () => {
    const res = await fetch("/api/admin/storage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "retry_orphans" }) });
    if (res.ok) {
      const d = await res.json();
      setStatus(d.status);
      setMsg(`Cleanup: ${d.result.deleted} deleted, ${d.result.failed} failed.`);
    } else setMsg("Cleanup failed.");
  };

  if (loading) return <div className="min-h-screen bg-app flex items-center justify-center text-sm text-secondary">Loading…</div>;
  if (denied || !status) {
    return (
      <div className="min-h-screen bg-app flex flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="font-semibold text-primary">Not authorised</p>
        <Link href="/" className="btn-primary px-6 py-3 text-sm">Go Home</Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-app px-4 py-6 flex flex-col items-center">
      <div className="w-full max-w-md flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <Link href="/" className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center"><ArrowLeft size={16} /></Link>
          <h1 className="text-lg font-bold text-primary">Thumbnail Storage (DBByte)</h1>
        </div>

        {!status.configured && (
          <div className="rounded-2xl p-3 text-xs bg-yellow-50 text-yellow-800 flex gap-2"><AlertTriangle size={14} className="flex-shrink-0" />DBByte is not configured (DBBYTE_API_KEY / DBBYTE_BUCKET / DBBYTE_CDN_BASE_URL). Thumbnail uploads are disabled.</div>
        )}
        {status.overallLevel !== "ok" && (
          <div className={cn("rounded-2xl p-3 text-xs flex gap-2", LEVEL_STYLE[status.overallLevel])}>
            <AlertTriangle size={14} className="flex-shrink-0" />
            Usage level: {status.overallLevel}.{status.uploadsBlocked ? " New thumbnail uploads are paused; existing thumbnails keep working." : ""}
          </div>
        )}

        <div className="bg-card border border-app rounded-2xl p-4 text-xs text-secondary">
          DBByte has no usage API, so the figures below are <b>manual</b> — copy them from your DBByte dashboard. Thresholds: warn {status.thresholds.warn}% · high {status.thresholds.high}% · uploads paused {status.thresholds.block}%.
        </div>

        {status.metrics.map((m) => (
          <div key={m.metric} className="bg-card border border-app rounded-2xl p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-primary text-sm">{LABELS[m.metric]}</p>
              <span className="chip text-xs bg-secondary text-secondary">{m.source === "manual" ? "manual" : "unknown"}</span>
            </div>
            {m.source === "manual" ? (
              <>
                <div className="h-2 rounded-full bg-secondary overflow-hidden"><div className="h-full gradient-brand" style={{ width: `${Math.min(100, m.percent ?? 0)}%` }} /></div>
                <p className="text-xs text-secondary">
                  {fmt(m.metric, m.used)} of {fmt(m.metric, m.limit)} ({(m.percent ?? 0).toFixed(1)}%) <span className={cn("chip ml-1 text-[10px]", LEVEL_STYLE[m.level])}>{m.level}</span>
                </p>
                <p className="text-[11px] text-muted">Entered {timeAgo(m.updatedAt)} (manual)</p>
              </>
            ) : <p className="text-xs text-secondary">No figures entered yet.</p>}
            <div className="grid grid-cols-2 gap-2">
              {(["used", "limit"] as const).map((k) => (
                <label key={k} className="text-[11px] text-secondary flex flex-col gap-1">
                  {k === "used" ? "Used" : "Plan limit"}{isBytes(m.metric) ? " (GB)" : ""}
                  <input className="input-app py-2 text-sm" inputMode="decimal" value={form[m.metric]?.[k] ?? ""} onChange={(e) => setForm((p) => ({ ...p, [m.metric]: { ...(p[m.metric] ?? { used: "", limit: "" }), [k]: e.target.value } }))} />
                </label>
              ))}
            </div>
            <button onClick={() => save(m.metric)} className="btn-primary py-2.5 text-sm">Save manual figures</button>
          </div>
        ))}

        <div className="bg-card border border-app rounded-2xl p-4 flex flex-col gap-1.5 text-xs text-secondary">
          <p className="font-semibold text-primary text-sm">Onfile-side estimate <span className="chip text-[10px] bg-secondary ml-1">estimated</span></p>
          <p>{status.estimated.thumbnails} thumbnails · {formatBytes(status.estimated.bytes)} stored (sum of our own records; not DBByte-reported)</p>
          <p>Upload/DB failures in the last 7 days: {status.failuresLast7d}</p>
          <p>Unreferenced objects awaiting cleanup: {status.orphanCount}</p>
          {status.orphanCount > 0 && <button onClick={retryOrphans} className="btn-primary py-2 text-sm mt-1">Retry cleanup</button>}
        </div>

        <div className="bg-card border border-app rounded-2xl p-4 text-xs">
          <p className="font-semibold text-primary text-sm mb-2">Recent upload failures</p>
          {status.recentFailures.length === 0 ? <p className="text-secondary">None recorded.</p> : (
            <ul className="flex flex-col gap-2">
              {status.recentFailures.map((f) => (
                <li key={f.id} className="text-secondary break-words"><b className="text-primary">{f.code}</b>{f.httpStatus ? ` (${f.httpStatus})` : ""} · {timeAgo(f.createdAt)}{f.message ? ` — ${f.message}` : ""}</li>
              ))}
            </ul>
          )}
        </div>
        {msg && <p className="text-xs text-center text-secondary">{msg}</p>}
      </div>
    </div>
  );
}
