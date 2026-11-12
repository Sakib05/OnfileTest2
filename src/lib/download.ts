/**
 * Logic behind the public file page (/f/[slug]) that is independent of React.
 *
 * Access is NEVER decided here. `requestUnlock` only asks the server
 * (POST /api/link/[slug]) and reports what the server answered; the Telegram
 * link is revealed solely from a successful server response (which enforces the
 * file password). The ad countdown is a UI step in front of that request — it
 * does not replace it.
 */

export interface DownloadFileInfo {
  id: number;
  title: string;
  description?: string | null;
  fileType: string;
  mimeType?: string | null;
  starsPrice?: number;
  hasPassword?: boolean;
  views?: number;
  downloads?: number;
  slug: string;
  thumbnailUrl?: string | null;
  thumbnailWidth?: number | null;
  thumbnailHeight?: number | null;
}

export interface DownloadCreatorInfo {
  firstName: string | null;
  username: string | null;
  avatarUrl: string | null;
}

export type UnlockMethod = "ad" | "password" | "stars";

/** Length of the pre-download advertisement step, in seconds (unchanged from the previous page). */
export const AD_SECONDS = 10;

/**
 * Which access options the page offers.
 * - Password-protected files can only be opened with the password: the server
 *   rejects an ad-only request for them, so offering the ad would waste the
 *   visitor's time. (The server remains the authority either way.)
 * - Everything else keeps the ad option, plus Stars when the file has a price.
 */
export function getUnlockMethods(file: Pick<DownloadFileInfo, "hasPassword" | "starsPrice">): UnlockMethod[] {
  const methods: UnlockMethod[] = [];
  if (file.hasPassword) methods.push("password");
  else methods.push("ad");
  if ((file.starsPrice ?? 0) > 0) methods.push("stars");
  return methods;
}

export type UnlockResult =
  | { ok: true; telegramMessageLink: string | null }
  | { ok: false; status: number; message: string };

export function unlockErrorMessage(status: number, serverMessage?: string): string {
  if (status === 403) return "Incorrect password. Please try again.";
  if (status === 404) return "This file is no longer available.";
  if (status === 429) return serverMessage || "Too many attempts. Please try again shortly.";
  return "Something went wrong. Please check your connection and try again.";
}

/** Asks the server to unlock the file. Never throws. */
export async function requestUnlock(slug: string, password?: string, fetchImpl: typeof fetch = fetch): Promise<UnlockResult> {
  try {
    const res = await fetchImpl(`/api/link/${encodeURIComponent(slug)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: password || "" }),
    });
    const data = (await res.json().catch(() => ({}))) as { telegramMessageLink?: string | null; error?: string };
    if (res.ok) return { ok: true, telegramMessageLink: data.telegramMessageLink ?? null };
    return { ok: false, status: res.status, message: unlockErrorMessage(res.status, data.error) };
  } catch {
    return { ok: false, status: 0, message: unlockErrorMessage(0) };
  }
}

/** Only http(s) links may be rendered as the "Open in Telegram" target (never javascript:/data: URLs). */
export function safeExternalLink(link: string | null | undefined): string | null {
  if (!link) return null;
  try {
    const u = new URL(link);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Preview frame ratio: the thumbnail's own ratio, clamped so the hero is neither a sliver nor a tower. */
export function previewAspectRatio(width?: number | null, height?: number | null): number {
  const fallback = 16 / 9;
  if (!width || !height || width <= 0 || height <= 0) return fallback;
  return Math.min(Math.max(width / height, 1), 1.91);
}
