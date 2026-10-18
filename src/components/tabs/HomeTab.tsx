"use client";
import React, { useState, useEffect, useCallback } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from "recharts";
import { Bell, TrendingUp, Download, Eye, DollarSign, Users, ChevronRight, Sparkles, Files } from "lucide-react";
import { useApp } from "@/contexts/AppContext";
import { formatNumber, formatCurrency } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface ChartData {
  label: string;
  views: number;
  downloads: number;
  earnings: number;
}

const PERIODS = [
  { label: "7 Days", value: 7 },
  { label: "15 Days", value: 15 },
  { label: "1 Month", value: 30 },
];

export default function HomeTab({ onTabChange }: { onTabChange?: (tab: string) => void }) {
  const { user } = useApp();
  const [period, setPeriod] = useState(7);
  const [chartData, setChartData] = useState<ChartData[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalFiles, setTotalFiles] = useState(0);
  const [seeded, setSeeded] = useState(false);

  const fetchAnalytics = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/analytics?days=${period}`);
      if (res.ok) {
        const data = await res.json();
        setChartData(data.chart || []);
        setTotalFiles(data.totalFiles || 0);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  const handleSeed = async () => {
    try {
      const res = await fetch("/api/seed", { method: "POST" });
      if (res.ok) {
        setSeeded(true);
        fetchAnalytics();
      }
    } catch { /* ignore */ }
  };

  const totalViews = chartData.reduce((a, b) => a + b.views, 0);
  const totalDownloads = chartData.reduce((a, b) => a + b.downloads, 0);
  const totalEarnings = chartData.reduce((a, b) => a + b.earnings, 0);

  return (
    <div className="flex flex-col gap-5 pb-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/onfile-logo.png"
          alt="Onfile"
          className="h-7 w-auto object-contain"
          draggable={false}
        />
        <button className="relative w-10 h-10 rounded-full bg-secondary flex items-center justify-center border border-app">
          <Bell size={18} style={{ color: "var(--color-text-secondary)" }} />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-brand" />
        </button>
      </div>

      {/* Balance Card */}
      <div className="rounded-2xl p-5 gradient-brand text-white relative overflow-hidden">
        <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full bg-white/10" />
        <div className="absolute -bottom-6 -right-4 w-20 h-20 rounded-full bg-white/10" />
        <div className="relative z-10">
          <div className="flex items-center gap-2 mb-1">
            <DollarSign size={14} className="opacity-80" />
            <span className="text-sm opacity-80 font-medium">Available Balance</span>
          </div>
          <p className="text-3xl font-bold mb-1">
            {formatCurrency(user?.balance)}
          </p>
          <p className="text-sm opacity-70">
            Pending: {formatCurrency(user?.pendingBalance)} · Total earned: {formatCurrency(user?.totalEarnings)}
          </p>
          <div className="flex gap-3 mt-4">
            <button
              className="flex-1 py-2 rounded-xl bg-white/20 hover:bg-white/30 transition-colors text-sm font-semibold text-white"
              onClick={() => onTabChange?.("wallet")}
            >
              Withdraw
            </button>
            <button
              className="flex-1 py-2 rounded-xl bg-white/20 hover:bg-white/30 transition-colors text-sm font-semibold text-white"
              onClick={() => onTabChange?.("wallet")}
            >
              History
            </button>
          </div>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { icon: Eye, label: "Views", value: formatNumber(totalViews), color: "text-blue-500", bg: "bg-blue-50 dark:bg-blue-900/20" },
          { icon: Download, label: "Downloads", value: formatNumber(totalDownloads), color: "text-green-500", bg: "bg-green-50 dark:bg-green-900/20" },
          { icon: TrendingUp, label: "Earnings", value: `$${totalEarnings.toFixed(2)}`, color: "text-brand", bg: "bg-brand-10" },
        ].map(({ icon: Icon, label, value, color, bg }) => (
          <div key={label} className="bg-card rounded-2xl p-3 border border-app shadow-app-sm">
            <div className={cn("w-8 h-8 rounded-xl flex items-center justify-center mb-2", bg)}>
              <Icon size={15} className={color} />
            </div>
            <p className="text-lg font-bold text-primary">{value}</p>
            <p className="text-xs text-secondary">{label}</p>
          </div>
        ))}
      </div>

      {/* Chart */}
      <div className="bg-card rounded-2xl p-4 border border-app shadow-app-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-primary text-sm">Performance</h2>
          <div className="flex gap-1">
            {PERIODS.map(({ label, value }) => (
              <button
                key={value}
                onClick={() => setPeriod(value)}
                className={cn(
                  "px-3 py-1 rounded-full text-xs font-medium transition-all",
                  period === value
                    ? "tab-active"
                    : "bg-secondary text-secondary hover:text-primary"
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="h-40 flex items-center justify-center">
            <div className="w-6 h-6 rounded-full border-2 border-brand border-t-transparent animate-spin" />
          </div>
        ) : chartData.length === 0 ? (
          <div className="h-40 flex flex-col items-center justify-center gap-3">
            <TrendingUp size={32} className="text-muted opacity-40" />
            <p className="text-sm text-secondary">No data yet. Upload your first file!</p>
            {!seeded && (
              <button
                onClick={handleSeed}
                className="px-4 py-2 rounded-xl btn-primary text-xs font-semibold"
              >
                Load Demo Data
              </button>
            )}
          </div>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={160}>
              <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
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
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: "var(--color-text-muted)" }}
                  axisLine={false}
                  tickLine={false}
                />
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
            <div className="flex gap-4 mt-3">
              <div className="flex items-center gap-1.5 text-xs text-secondary">
                <span className="w-2.5 h-2.5 rounded-full bg-brand inline-block" />Views
              </div>
              <div className="flex items-center gap-1.5 text-xs text-secondary">
                <span className="w-2.5 h-2.5 rounded-full bg-green-500 inline-block" />Downloads
              </div>
            </div>
          </>
        )}
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-card rounded-2xl p-4 border border-app shadow-app-sm">
          <div className="flex items-center gap-2 mb-1">
            <Files size={14} className="text-brand" />
            <span className="text-xs text-secondary font-medium">Total Files</span>
          </div>
          <p className="text-2xl font-bold text-primary">{totalFiles}</p>
        </div>
        <div className="bg-card rounded-2xl p-4 border border-app shadow-app-sm">
          <div className="flex items-center gap-2 mb-1">
            <Users size={14} className="text-brand" />
            <span className="text-xs text-secondary font-medium">Total Downloads</span>
          </div>
          <p className="text-2xl font-bold text-primary">{formatNumber(user?.totalDownloads ?? 0)}</p>
        </div>
      </div>

      {/* Referral Banner */}
      <div
        className="rounded-2xl p-4 flex items-center gap-3 cursor-pointer"
        style={{ background: "linear-gradient(135deg, rgba(255,97,21,0.08) 0%, rgba(255,140,74,0.12) 100%)", border: "1.5px solid rgba(255,97,21,0.2)" }}
        onClick={() => onTabChange?.("profile")}
      >
        <div className="w-10 h-10 rounded-xl gradient-brand flex items-center justify-center flex-shrink-0">
          <Sparkles size={18} color="white" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-primary">Earn 5% Referral Commission!</p>
          <p className="text-xs text-secondary mt-0.5">Invite creators and earn from their earnings forever.</p>
        </div>
        <ChevronRight size={16} className="text-brand flex-shrink-0" />
      </div>
    </div>
  );
}


