"use client";
import { useEffect, useState } from "react";
import type { MiniAppLinkConfig } from "@/lib/miniAppLink";

/**
 * Loads the public bot username + optional Mini App short name from
 * /api/telegram/bot-info (public information only). Returns `null` until
 * loaded or if the lookup fails — callers must treat null as "no Mini App
 * link available" and fall back to the normal web URL.
 */
export function useMiniAppLinkConfig(enabled: boolean = true): MiniAppLinkConfig | null {
  const [config, setConfig] = useState<MiniAppLinkConfig | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetch("/api/telegram/bot-info")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setConfig({
          botUsername: typeof data.username === "string" ? data.username : null,
          appShortName: typeof data.miniAppShortName === "string" ? data.miniAppShortName : null,
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return config;
}
