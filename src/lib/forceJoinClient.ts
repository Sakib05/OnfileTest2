import { getTelegramWebApp } from "@/lib/telegramWebApp";

/** Client for the Force Join membership gate of one file. The client never states membership — it only asks the server. */
export type GateUiState = "login_required" | "join_required" | "unavailable" | "passed";

export interface GateResponse {
  gated: boolean;
  state?: GateUiState;
  channelTitle?: string | null;
  channelUsername?: string | null;
  joinUrl?: string | null;
}

export type GateCheck = { ok: true; gate: GateResponse } | { ok: false; message: string };

export async function callGate(slug: string, action: "start" | "verify", fetchImpl: typeof fetch = fetch): Promise<GateCheck> {
  try {
    const res = await fetchImpl(`/api/link/${encodeURIComponent(slug)}/gate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const data = (await res.json().catch(() => ({}))) as GateResponse & { error?: string };
    if (!res.ok) return { ok: false, message: data.error || "We couldn't check the channel requirement. Please try again." };
    return { ok: true, gate: data };
  } catch {
    return { ok: false, message: "We couldn't check the channel requirement. Check your connection and try again." };
  }
}

/** Only an https Telegram link is ever opened for the Join action (the server validated it too). */
export function openJoinLink(url: string | null | undefined): boolean {
  if (!url) return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || (u.hostname !== "t.me" && u.hostname !== "telegram.me")) return false;
  const tg = getTelegramWebApp();
  if (tg && typeof tg.openTelegramLink === "function") tg.openTelegramLink(u.toString());
  else window.open(u.toString(), "_blank", "noopener,noreferrer");
  return true;
}
