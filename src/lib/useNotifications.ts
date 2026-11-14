"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export type NotificationDestinationType = "file" | "channels" | "wallet";

/** Shape returned by GET /api/notifications (see src/lib/notifications.ts → PublicNotification). */
export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
  destination: { type: NotificationDestinationType; available: boolean } | null;
}

export type NotificationsStatus = "idle" | "loading" | "ready" | "error";

/** How often the bell badge re-checks while the Dashboard is visible. */
export const BADGE_POLL_MS = 60_000;

/**
 * Client state for the Dashboard bell + notification screen.
 *
 *  - `unreadCount` drives the badge. It is refreshed with a cheap summary call
 *    on mount, every minute while the page is visible, and whenever the Mini
 *    App comes back to the foreground — no full reload needed.
 *  - `load()` fetches the list (when the screen opens). The server is the source
 *    of truth: after every read action the server's returned `unreadCount` is applied.
 *  - `markRead` / `markAllRead` update the UI immediately and roll back by
 *    re-fetching if the server rejects the change.
 *
 * The user is never sent to the API: identity is the session cookie.
 */
export function useNotifications(enabled: boolean = true) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [status, setStatus] = useState<NotificationsStatus>("idle");
  const [unreadCount, setUnreadCount] = useState(0);
  const mounted = useRef(true);
  const listInFlight = useRef<Promise<void> | null>(null);
  const markAllInFlight = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refreshBadge = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications?summary=1", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json().catch(() => null)) as { unreadCount?: unknown } | null;
      if (mounted.current && typeof data?.unreadCount === "number") setUnreadCount(data.unreadCount);
    } catch {
      /* the badge is best-effort; keep the last known count */
    }
  }, []);

  const load = useCallback((): Promise<void> => {
    if (listInFlight.current) return listInFlight.current;
    const run = (async () => {
      setStatus((s) => (s === "ready" ? s : "loading"));
      try {
        const res = await fetch("/api/notifications", { cache: "no-store" });
        const data = (await res.json().catch(() => null)) as { notifications?: unknown; unreadCount?: unknown } | null;
        if (!mounted.current) return;
        if (!res.ok || !data || !Array.isArray(data.notifications)) {
          setStatus("error");
          return;
        }
        setItems(data.notifications as NotificationItem[]);
        if (typeof data.unreadCount === "number") setUnreadCount(data.unreadCount);
        setStatus("ready");
      } catch {
        if (mounted.current) setStatus("error");
      }
    })().finally(() => {
      listInFlight.current = null;
    });
    listInFlight.current = run;
    return run;
  }, []);

  // Badge: initial value, minute poll while visible, refresh on return to the foreground.
  useEffect(() => {
    if (!enabled) return;
    void refreshBadge();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refreshBadge();
    }, BADGE_POLL_MS);
    const onReturn = () => {
      if (document.visibilityState === "visible") void refreshBadge();
    };
    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("focus", onReturn);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("focus", onReturn);
    };
  }, [enabled, refreshBadge]);

  const postRead = useCallback(async (body: { id: string } | { all: true }): Promise<boolean> => {
    try {
      const res = await fetch("/api/notifications/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => null)) as { unreadCount?: unknown } | null;
      if (!res.ok) return false;
      if (mounted.current && typeof data?.unreadCount === "number") setUnreadCount(data.unreadCount);
      return true;
    } catch {
      return false;
    }
  }, []);

  const markRead = useCallback(
    async (id: string): Promise<boolean> => {
      let wasUnread = false;
      setItems((prev) =>
        prev.map((n) => {
          if (n.id !== id || n.read) return n;
          wasUnread = true;
          return { ...n, read: true };
        })
      );
      if (!wasUnread) return true; // already read: nothing to send
      setUnreadCount((c) => Math.max(0, c - 1));
      const ok = await postRead({ id });
      if (!ok && mounted.current) void load(); // roll back to the server's truth
      return ok;
    },
    [postRead, load]
  );

  const markAllRead = useCallback(async (): Promise<boolean> => {
    if (markAllInFlight.current) return true; // ignore repeated taps
    markAllInFlight.current = true;
    try {
      setItems((prev) => prev.map((n) => (n.read ? n : { ...n, read: true })));
      setUnreadCount(0);
      const ok = await postRead({ all: true });
      if (!ok && mounted.current) void load();
      return ok;
    } finally {
      markAllInFlight.current = false;
    }
  }, [postRead, load]);

  return { items, status, unreadCount, load, refreshBadge, markRead, markAllRead };
}
