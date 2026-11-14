"use client";
import React, { useState, useEffect, useCallback } from "react";
import { Bell, TrendingUp, Download, Eye, DollarSign, Users, ChevronRight, Sparkles, Files } from "lucide-react";
import { useApp } from "@/contexts/AppContext";
import PerformanceChart from "@/components/dashboard/PerformanceChart";
import NotificationsScreen from "@/components/notifications/NotificationsScreen";
import { useToast } from "@/components/ui/Toast";
import { useNotifications, type NotificationItem } from "@/lib/useNotifications";
import { useTelegramBackButton } from "@/lib/useTelegramBackButton";
import { formatNumber, formatCurrency } from "@/lib/utils";
import { cn } from "@/lib/utils";

import type { PerformancePoint as ChartData } from "@/components/dashboard/PerformanceChart";

const PERIODS = [
  { label: "7 Days", value: 7 },
  { label: "15 Days", value: 15 },
  { label: "1 Month", value: 30 },
];

export default function HomeTab({ onTabChange }: { onTabChange?: (tab: string) => void }) {
  const { user, setProfileEntry } = useApp();
  const { toast } = useToast();
  const [showNotifications, setShowNotifications] = useState(false);
  const notifications = useNotifications();
  // The notification screen is a nested page: Telegram's native Back Button is
  // shown while it is open and closes it; on the Dashboard root it stays hidden.
  useTelegramBackButton(() => setShowNotifications(false), showNotifications);
  const [period, setPeriod] = useState(7);
  const [chartData, setChartData] = useState<ChartData[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalFiles, setTotalFiles] = useState(0);

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

  const openNotification = useCallback(
    (n: NotificationItem) => {
      if (!n.read) void notifications.markRead(n.id);
      const dest = n.destination;
      if (!dest) return;
      if (!dest.available) {
        toast("That item is no longer available.", "info");
        return;
      }
      setShowNotifications(false);
      if (dest.type === "file") onTabChange?.("files");
      else if (dest.type === "wallet") onTabChange?.("wallet");
      else if (dest.type === "channels") {
        setProfileEntry("channel");
        onTabChange?.("profile");
      }
    },
    [notifications, onTabChange, setProfileEntry, toast]
  );

  const totalViews = chartData.reduce((a, b) => a + b.views, 0);
  const totalDownloads = chartData.reduce((a, b) => a + b.downloads, 0);
  const totalEarnings = chartData.reduce((a, b) => a + b.earnings, 0);

  if (showNotifications) {
    return (
      <NotificationsScreen
        items={notifications.items}
        status={notifications.status}
        unreadCount={notifications.unreadCount}
        onLoad={() => void notifications.load()}
        onOpen={openNotification}
        onMarkRead={(id) => void notifications.markRead(id)}
        onMarkAllRead={() => void notifications.markAllRead()}
      />
    );
  }

  const unread = notifications.unreadCount;

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
        <button
          type="button"
          onClick={() => setShowNotifications(true)}
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
          data-testid="notifications-bell"
          className="relative w-10 h-10 rounded-full bg-secondary flex items-center justify-center border border-app active:scale-95 transition-transform"
        >
          <Bell size={18} style={{ color: "var(--color-text-secondary)" }} />
          {unread > 0 && (
            <span
              data-testid="notifications-badge"
              className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-brand text-white text-[10px] font-bold leading-none flex items-center justify-center border-2 border-[var(--color-bg)]"
            >
              {unread > 9 ? "9+" : unread}
            </span>
          )}
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
            <p className="text-sm text-secondary">No data yet. Upload your first file to see performance here.</p>
          </div>
        ) : (
          <>
            <PerformanceChart data={chartData} />
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
