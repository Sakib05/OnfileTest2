"use client";
import React, { useCallback, useEffect, useState } from "react";
import { cn, formatBytes } from "@/lib/utils";

type Json = any;

const STATUS_STYLE: Record<string, string> = {
  ACTIVE: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  NEAR_LIMIT: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300",
  EXHAUSTED: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  DRAINING: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
  DISABLED: "bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300",
  ERROR: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  HEALTHY: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  DEGRADED: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300",
  CRITICAL: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
};

function Badge({ text }: { text: string }) {
  return <span className={cn("chip text-xs font-semibold px-2 py-0.5 rounded-full", STATUS_STYLE[text] ?? "bg-secondary text-secondary")}>{text}</span>;
}

function when(v: string | null | undefined) {
  return v ? new Date(v).toLocaleString() : "never";
}

function Meter({ label, used, quota, percent, source, count }: { label: string; used: number; quota: number | null; percent: number | null; source: string; count?: boolean }) {
  const fmt = (n: number) => (count ? n.toLocaleString() : formatBytes(n).replace("Unknown size", "0 B"));
  const pct = percent === null ? 0 : Math.min(100, percent);
  return (
    <div>
      <div className="flex justify-between text-xs">
        <span className="text-secondary">{label}</span>
        <span className="text-primary font-medium">
          {fmt(used)} / {quota === null ? "quota unknown" : fmt(quota)}
          {percent !== null && ` (${percent.toFixed(1)}%)`}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-secondary overflow-hidden mt-1">
        <div className={cn("h-full", pct >= 90 ? "bg-red-500" : pct >= 80 ? "bg-yellow-500" : "bg-green-500")} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-[10px] text-muted mt-0.5">source: {source}</p>
    </div>
  );
}

export default function StorageAdminPage() {
  const [data, setData] = useState<Json>(null);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/storage", { cache: "no-store" });
      if (res.status === 401 || res.status === 403) {
        setForbidden(true);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (payload: Record<string, unknown>, label?: string) => {
    setBusy(label ?? String(payload.action));
    setMessage(null);
    try {
      const res = await fetch("/api/admin/storage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const j = await res.json().catch(() => ({}));
      setMessage(res.ok ? `${label ?? payload.action}: done` : `${label ?? payload.action}: ${j.error ?? res.status}`);
      await load();
    } finally {
      setBusy(null);
    }
  };

  if (forbidden) {
    return (
      <div className="min-h-screen bg-app flex items-center justify-center p-6">
        <div className="bg-card border border-app rounded-2xl p-6 max-w-sm text-center">
          <p className="font-bold text-primary">Admin access required</p>
          <p className="text-sm text-secondary mt-1">Open Onfile inside Telegram with an administrator account.</p>
        </div>
      </div>
    );
  }
  if (!data) {
    return <div className="min-h-screen bg-app flex items-center justify-center text-secondary">{error ?? "Loading storage dashboard…"}</div>;
  }

  const startEdit = (p: Json) => {
    setEditing(p.key);
    setForm({
      storageQuota: p.storage.quota ?? "",
      bandwidthQuota: p.bandwidth.quota ?? "",
      requestQuota: p.requests.quota ?? "",
      billingCycleDay: p.billingCycleDay ?? "",
      weight: String(p.weight),
      maxAssets: p.maxAssets ?? "",
      storageUsed: "",
      bandwidthUsed: "",
      requestUsed: "",
    });
  };
  const num = (v: string): number | null => (v.trim() === "" ? null : Number(v));
  const saveEdit = async (key: string) => {
    const payload: Record<string, unknown> = {
      action: "setQuotas",
      providerKey: key,
      storageQuota: num(form.storageQuota),
      bandwidthQuota: num(form.bandwidthQuota),
      requestQuota: num(form.requestQuota),
      billingCycleDay: num(form.billingCycleDay),
    };
    for (const k of ["storageUsed", "bandwidthUsed", "requestUsed"]) if (form[k]?.trim()) payload[k] = Number(form[k]);
    await act(payload, "Save quotas");
    await act({ action: "setWeight", providerKey: key, weight: Number(form.weight), maxAssets: num(form.maxAssets) }, "Save weight");
    setEditing(null);
  };

  return (
    <div className="min-h-screen bg-app text-primary">
      <div className="max-w-5xl mx-auto p-4 flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3 justify-between">
          <div>
            <h1 className="text-xl font-bold">Thumbnail Storage</h1>
            <p className="text-xs text-secondary">Generated {when(data.generatedAt)} · only thumbnails are stored externally</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge text={data.systemHealth} />
            <button className="btn-secondary px-3 py-1.5 text-xs" onClick={load}>Refresh</button>
            <button className="btn-primary px-3 py-1.5 text-xs" disabled={!!busy} onClick={() => act({ action: "runMaintenance" }, "Run maintenance")}>
              {busy === "Run maintenance" ? "Running…" : "Run maintenance now"}
            </button>
            <button className="btn-secondary px-3 py-1.5 text-xs" onClick={() => act({ action: data.migrations.paused ? "resumeMigrations" : "pauseMigrations" })}>
              {data.migrations.paused ? "Resume migrations" : "Pause migrations"}
            </button>
          </div>
        </div>

        {message && <div className="bg-card border border-app rounded-xl p-3 text-xs">{message}</div>}
        {data.adminsConfigured === 0 && <div className="bg-red-50 text-red-700 rounded-xl p-3 text-xs">ADMIN_TELEGRAM_IDS is empty — Telegram alerts cannot be delivered.</div>}
        {data.warnings.length > 0 && (
          <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-xl p-3">
            <p className="text-xs font-semibold mb-1">Warnings</p>
            <ul className="text-xs list-disc pl-4 space-y-0.5">{data.warnings.map((w: string, i: number) => <li key={i}>{w}</li>)}</ul>
          </div>
        )}

        {/* Providers */}
        <div className="grid md:grid-cols-2 gap-4">
          {data.providers.map((p: Json) => (
            <div key={p.key} className="bg-card border border-app rounded-2xl p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="font-bold">{p.label}</p>
                <div className="flex gap-1.5 items-center flex-wrap">
                  <Badge text={p.status} />
                  <span className="text-[10px] text-secondary">{p.enabled ? "enabled" : "disabled"}</span>
                  <span className="text-[10px] text-secondary">· {p.configured ? "configured" : "NOT configured"}</span>
                </div>
              </div>
              <div className="text-xs text-secondary grid grid-cols-2 gap-x-3 gap-y-0.5">
                <span>Health: {p.health.ok === null ? "unknown" : p.health.ok ? "OK" : "FAILING"}</span>
                <span>Last check: {when(p.health.lastCheck)}</span>
                <span>Usage source: <b>{p.usageSource}</b></span>
                <span>Last usage sync: {when(p.lastUsageSync)}</span>
                <span>Terms: {p.commercialTermsStatus}</span>
                <span>Thumbnails: {p.assetCount} ({formatBytes(p.assetBytes)})</span>
                <span>Weight: {p.weight}{p.maxAssets !== null ? ` · max ${p.maxAssets}` : ""}</span>
                <span>Billing cycle day: {p.billingCycleDay ?? "unknown (no auto reset)"}</span>
              </div>
              <Meter label="Storage" used={p.storage.used} quota={p.storage.quota} percent={p.storage.percent} source={p.storage.source} />
              <Meter label="Bandwidth (monthly)" used={p.bandwidth.used} quota={p.bandwidth.quota} percent={p.bandwidth.percent} source={p.bandwidth.source} />
              {p.bandwidth.breakdown?.note && <p className="text-[10px] text-muted -mt-2">{p.bandwidth.breakdown.note}</p>}
              <Meter label="Requests (monthly)" used={p.requests.used} quota={p.requests.quota} percent={p.requests.percent} source={p.requests.source} count />
              {p.usageNotes.unsupported && <p className="text-[10px] text-muted">Usage API: {p.usageNotes.unsupported}</p>}
              {p.errorDetails && <p className="text-xs text-red-500 break-words">Last error: {p.errorDetails}</p>}
              {p.recentErrors.length > 0 && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-secondary">Recent issues ({p.recentErrors.length})</summary>
                  <ul className="mt-1 space-y-1">{p.recentErrors.map((e: Json, i: number) => <li key={i}><span className="text-muted">{when(e.at)}</span> {e.message}</li>)}</ul>
                </details>
              )}

              <div className="flex flex-wrap gap-1.5">
                <button className="btn-secondary px-2.5 py-1 text-xs" onClick={() => act({ action: "setEnabled", providerKey: p.key, enabled: !p.enabled }, p.enabled ? "Disable" : "Enable")}>{p.enabled ? "Disable" : "Enable"}</button>
                <button className="btn-secondary px-2.5 py-1 text-xs" onClick={() => act({ action: "health", providerKey: p.key }, "Health check")}>Inspect health</button>
                <button className="btn-secondary px-2.5 py-1 text-xs" onClick={() => act({ action: "syncUsage", providerKey: p.key }, "Sync usage")}>Sync usage</button>
                <button className="btn-secondary px-2.5 py-1 text-xs" onClick={() => startEdit(p)}>Quotas / weight</button>
                <button className="btn-secondary px-2.5 py-1 text-xs" onClick={() => act({ action: "setDraining", providerKey: p.key, draining: p.status !== "DRAINING" }, p.status === "DRAINING" ? "Stop draining" : "Drain")}>{p.status === "DRAINING" ? "Stop draining" : "Drain"}</button>
                <button className="btn-secondary px-2.5 py-1 text-xs" onClick={() => act({ action: "startMigration", providerKey: p.key }, "Start migration")}>Migrate away</button>
                {(p.status === "ERROR" || p.status === "EXHAUSTED") && <button className="btn-secondary px-2.5 py-1 text-xs" onClick={() => act({ action: "clearError", providerKey: p.key }, "Clear error")}>Clear error</button>}
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-secondary">Commercial terms:</span>
                <select className="input-app py-1 text-xs" value={p.commercialTermsStatus} onChange={(e) => act({ action: "setTerms", providerKey: p.key, status: e.target.value }, "Set terms")}>
                  {["UNREVIEWED", "PERMITTED", "AMBIGUOUS", "PROHIBITED"].map((s) => <option key={s}>{s}</option>)}
                </select>
              </div>

              {editing === p.key && (
                <div className="border border-app rounded-xl p-3 grid grid-cols-2 gap-2 text-xs">
                  {[
                    ["storageQuota", "Storage quota (bytes)"],
                    ["bandwidthQuota", "Bandwidth quota / month (bytes)"],
                    ["requestQuota", "Request quota / month"],
                    ["billingCycleDay", "Billing cycle day (1-28)"],
                    ["storageUsed", "Set storage used (manual)"],
                    ["bandwidthUsed", "Set bandwidth used (manual)"],
                    ["requestUsed", "Set requests used (manual)"],
                    ["weight", "Allocation weight (0-100)"],
                    ["maxAssets", "Max thumbnails (blank = none)"],
                  ].map(([k, label]) => (
                    <label key={k} className="flex flex-col gap-0.5">
                      <span className="text-secondary">{label}</span>
                      <input className="input-app py-1 text-xs" inputMode="decimal" value={form[k] ?? ""} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))} />
                    </label>
                  ))}
                  <div className="col-span-2 flex gap-2">
                    <button className="btn-primary px-3 py-1.5 text-xs" onClick={() => saveEdit(p.key)}>Save</button>
                    <button className="btn-secondary px-3 py-1.5 text-xs" onClick={() => setEditing(null)}>Cancel</button>
                  </div>
                  <p className="col-span-2 text-[10px] text-muted">Manual values are labelled MANUAL. Quotas shown by DBByte (20 GB / 100 GB / 10K requests) are user-observed dashboard values, not guaranteed entitlements.</p>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Allocation */}
        <div className="bg-card border border-app rounded-2xl p-4">
          <p className="font-bold mb-2">Allocation distribution ({data.allocation.totalAssets} thumbnails)</p>
          <div className="flex flex-col gap-1.5">
            {data.allocation.distribution.map((d: Json) => (
              <div key={d.key} className="text-xs">
                <div className="flex justify-between"><span>{d.label}</span><span>{d.count} · {formatBytes(d.bytes)} · {d.percent.toFixed(1)}%</span></div>
                <div className="h-1.5 bg-secondary rounded-full overflow-hidden"><div className="h-full gradient-brand" style={{ width: `${d.percent}%` }} /></div>
              </div>
            ))}
          </div>
          <p className="text-xs font-semibold mt-3">Next-upload probabilities</p>
          <ul className="text-xs text-secondary mt-1 space-y-0.5">
            {data.allocation.nextUploadPreview.ranked.map((r: Json) => <li key={r.providerKey}>{r.providerKey}: {(r.probability * 100).toFixed(1)}%</li>)}
            {data.allocation.nextUploadPreview.excluded.map((e: Json) => <li key={e.providerKey} className="text-muted">{e.providerKey}: excluded ({e.reasons.join(", ")})</li>)}
          </ul>
        </div>

        {/* Migrations */}
        <div className="bg-card border border-app rounded-2xl p-4">
          <p className="font-bold mb-1">Migration queue {data.migrations.paused && <span className="text-xs text-orange-500">(paused)</span>}</p>
          <p className="text-xs text-secondary mb-2">{Object.entries(data.migrations.counts).map(([k, v]) => `${k}: ${v}`).join(" · ") || "no jobs"}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-left text-secondary"><th className="py-1">#</th><th>Asset</th><th>Status</th><th>Retries</th><th>Reason</th><th>Error</th><th></th></tr></thead>
              <tbody>
                {data.migrations.jobs.map((j: Json) => (
                  <tr key={j.id} className="border-t border-app align-top">
                    <td className="py-1">{j.id}</td><td>{j.assetId}</td><td>{j.status}</td><td>{j.retryCount}</td><td>{j.reason}</td>
                    <td className="max-w-[220px] break-words text-red-500">{j.errorDetails}</td>
                    <td className="whitespace-nowrap">
                      {j.status === "pending" && <button className="text-brand mr-2" onClick={() => act({ action: "pauseJob", jobId: j.id })}>Pause</button>}
                      {j.status === "paused" && <button className="text-brand mr-2" onClick={() => act({ action: "resumeJob", jobId: j.id })}>Resume</button>}
                      {j.status === "failed" && <button className="text-brand" onClick={() => act({ action: "retryJob", jobId: j.id })}>Retry</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Settings */}
        <div className="bg-card border border-app rounded-2xl p-4">
          <p className="font-bold mb-2">Thresholds</p>
          <div className="flex flex-wrap gap-3 items-end text-xs">
            {(["warnPercent", "criticalPercent", "safetyMarginPercent"] as const).map((k) => (
              <label key={k} className="flex flex-col gap-0.5">
                <span className="text-secondary">{k}</span>
                <input className="input-app py-1 text-xs w-28" defaultValue={data.settings[k]} onBlur={(e) => { const v = Number(e.target.value); if (v !== data.settings[k]) act({ action: "setSettings", settings: { [k]: v } }, `Set ${k}`); }} />
              </label>
            ))}
          </div>
        </div>

        {/* Events + audit */}
        <div className="grid md:grid-cols-2 gap-4">
          <div className="bg-card border border-app rounded-2xl p-4">
            <p className="font-bold mb-2">Recent provider events</p>
            <ul className="text-xs space-y-1 max-h-80 overflow-y-auto">
              {data.events.map((e: Json) => (
                <li key={e.id}><span className="text-muted">{when(e.createdAt)}</span> <span className={cn("font-semibold", e.severity === "error" || e.severity === "critical" ? "text-red-500" : e.severity === "warning" ? "text-yellow-600" : "text-secondary")}>[{e.severity}]</span> {e.message}</li>
              ))}
            </ul>
          </div>
          <div className="bg-card border border-app rounded-2xl p-4">
            <p className="font-bold mb-2">Admin audit history</p>
            <ul className="text-xs space-y-1 max-h-80 overflow-y-auto">
              {data.audit.length === 0 && <li className="text-muted">No admin actions yet.</li>}
              {data.audit.map((a: Json) => (
                <li key={a.id}><span className="text-muted">{when(a.createdAt)}</span> admin {a.actorTelegramId}: <b>{a.action}</b> {a.targetType ? `${a.targetType}:${a.targetId ?? ""}` : ""}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
