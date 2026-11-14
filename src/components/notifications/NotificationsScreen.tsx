"use client";
import React, { useEffect } from "react";
import {
  AlertTriangle,
  Bell,
  CheckCheck,
  CheckCircle2,
  FileCheck2,
  Link2Off,
  Loader2,
  Radio,
  RefreshCw,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import RelativeTime from "@/components/library/RelativeTime";
import type { NotificationItem, NotificationsStatus } from "@/lib/useNotifications";

const ICONS: Record<string, { icon: LucideIcon; tone: string }> = {
  channel_connected: { icon: CheckCircle2, tone: "bg-green-50 text-green-500 dark:bg-green-900/20" },
  channel_connection_failed: { icon: AlertTriangle, tone: "bg-red-50 text-red-500 dark:bg-red-900/20" },
  channel_attention: { icon: AlertTriangle, tone: "bg-amber-50 text-amber-500 dark:bg-amber-900/20" },
  channel_disconnected: { icon: Link2Off, tone: "bg-secondary text-secondary" },
  file_published: { icon: FileCheck2, tone: "bg-brand-10 text-brand" },
  withdrawal_requested: { icon: Wallet, tone: "bg-blue-50 text-blue-500 dark:bg-blue-900/20" },
};
const FALLBACK_ICON = { icon: Radio, tone: "bg-secondary text-secondary" };

/**
 * The notification screen opened from the Dashboard bell. A full in-app screen
 * (not a popup): it has NO back arrow of its own — the parent registers
 * Telegram's native Back Button for it (useTelegramBackButton) and the root
 * Dashboard hides that button again once the screen is closed.
 */
export default function NotificationsScreen({
  items,
  status,
  unreadCount,
  onLoad,
  onOpen,
  onMarkRead,
  onMarkAllRead,
}: {
  items: NotificationItem[];
  status: NotificationsStatus;
  unreadCount: number;
  onLoad: () => void;
  onOpen: (n: NotificationItem) => void;
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
}) {
  // Fetch when the screen opens (the list is never loaded in the background).
  useEffect(() => {
    onLoad();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col gap-4 animate-fade-in" data-testid="notifications-screen">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-primary">Notifications</h1>
          <p className="text-xs text-secondary" data-testid="notifications-subtitle">
            {unreadCount > 0 ? `${unreadCount} unread` : "You're all caught up"}
          </p>
        </div>
        <button
          type="button"
          onClick={onMarkAllRead}
          disabled={unreadCount === 0}
          data-testid="notifications-mark-all"
          className="flex-shrink-0 h-9 px-3 rounded-full bg-secondary border border-app text-xs font-semibold text-primary flex items-center gap-1.5 disabled:opacity-40 active:scale-95 transition"
        >
          <CheckCheck size={14} />
          Mark all as read
        </button>
      </div>

      {status === "loading" || (status === "idle" && items.length === 0) ? (
        <div className="flex flex-col gap-2" data-testid="notifications-loading" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="bg-card rounded-2xl border border-app p-4 flex gap-3 animate-pulse">
              <div className="w-10 h-10 rounded-xl bg-secondary flex-shrink-0" />
              <div className="flex-1 flex flex-col gap-2">
                <div className="h-3 w-1/2 rounded bg-secondary" />
                <div className="h-3 w-5/6 rounded bg-secondary" />
              </div>
            </div>
          ))}
        </div>
      ) : status === "error" && items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-14 text-center" data-testid="notifications-error" role="alert">
          <AlertTriangle size={28} className="text-red-500" />
          <p className="text-sm text-secondary">We couldn&apos;t load your notifications.</p>
          <button type="button" onClick={onLoad} className="btn-secondary px-5 py-2 text-sm flex items-center gap-2">
            <RefreshCw size={14} /> Try again
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center" data-testid="notifications-empty">
          <div className="w-14 h-14 rounded-2xl bg-secondary flex items-center justify-center">
            <Bell size={24} className="text-muted" />
          </div>
          <div>
            <p className="font-semibold text-primary">No notifications yet</p>
            <p className="text-sm text-secondary mt-1 max-w-[16rem]">
              Updates about your channels, published files and withdrawals will show up here.
            </p>
          </div>
        </div>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="notifications-list">
          {items.map((n) => {
            const { icon: Icon, tone } = ICONS[n.type] ?? FALLBACK_ICON;
            return (
              <li key={n.id} data-testid="notification-item" data-read={n.read ? "true" : "false"}>
                <div
                  className={cn(
                    "relative flex items-start gap-3 rounded-2xl border p-3.5 transition-colors",
                    n.read ? "bg-card border-app" : "bg-brand-10 border-brand/30"
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onOpen(n)}
                    className="flex flex-1 min-w-0 items-start gap-3 text-left"
                    aria-label={`${n.read ? "" : "Unread: "}${n.title}`}
                  >
                    <span className={cn("w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0", tone)}>
                      <Icon size={18} />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className={cn("block text-sm text-primary", n.read ? "font-medium" : "font-bold")}>{n.title}</span>
                      <span className="block text-xs text-secondary mt-0.5 leading-relaxed break-words">{n.body}</span>
                      <RelativeTime value={n.createdAt} className="block text-[11px] text-muted mt-1" />
                    </span>
                  </button>
                  {!n.read && (
                    <button
                      type="button"
                      onClick={() => onMarkRead(n.id)}
                      aria-label="Mark as read"
                      data-testid="notification-mark-read"
                      className="flex-shrink-0 w-8 h-8 -mr-1 -mt-1 flex items-center justify-center"
                    >
                      <span className="w-2.5 h-2.5 rounded-full bg-brand" />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {status === "loading" && items.length > 0 && (
        <div className="flex justify-center py-2">
          <Loader2 size={16} className="animate-spin text-brand" />
        </div>
      )}
    </div>
  );
}
