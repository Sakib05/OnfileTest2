"use client";
import { getTelegramWebApp } from "@/lib/telegramWebApp";
import { telegramShareUrl } from "@/lib/playlistSharing";

export interface ShareInfo {
  slug: string;
  path: string;
  url: string;
  hasPassword: boolean;
}

export type ShareLinkResult = { ok: true; share: ShareInfo } | { ok: false; reason: "private" | "paid_unavailable" | "error"; message: string };

/** Asks the server (owner-only, same-origin POST) for the playlist's stable public link. Never throws. */
export async function requestShareLink(playlistId: number, fetchImpl: typeof fetch = fetch): Promise<ShareLinkResult> {
  try {
    const res = await fetchImpl(`/api/playlists/${playlistId}/share`, { method: "POST", headers: { "Content-Type": "application/json" } });
    const data = (await res.json().catch(() => null)) as { share?: ShareInfo; error?: string; reason?: string } | null;
    if (res.ok && data?.share?.url) return { ok: true, share: data.share };
    const reason = data?.reason === "private" || data?.reason === "paid_unavailable" ? data.reason : "error";
    return { ok: false, reason, message: data?.error ?? "Couldn't create the share link. Please try again." };
  } catch {
    return { ok: false, reason: "error", message: "Network error. Please try again." };
  }
}

/** Clipboard API first, then the legacy selection fallback (some Telegram webviews block the async API). */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

export function canNativeShare(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.share === "function";
}

/** Opens Telegram's share dialog for `url`. Inside the Mini App the bridge keeps the app open; elsewhere a new tab. */
export function openTelegramShare(url: string, text?: string): void {
  const target = telegramShareUrl(url, text);
  const tg = getTelegramWebApp();
  if (tg?.openTelegramLink) tg.openTelegramLink(target);
  else window.open(target, "_blank", "noopener,noreferrer");
}

/** Native share sheet. Resolves "cancelled" (silently ignorable) when the user dismisses it. */
export async function nativeShare(data: { title: string; text?: string; url: string }): Promise<"shared" | "cancelled" | "failed"> {
  try {
    await navigator.share(data);
    return "shared";
  } catch (e) {
    return e instanceof DOMException && e.name === "AbortError" ? "cancelled" : "failed";
  }
}
