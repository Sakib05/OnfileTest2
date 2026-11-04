import { and, desc, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { storageProviderEvents } from "@/db/schema";
import { getSettings } from "./settings";

export type Severity = "info" | "warning" | "error" | "critical";

export function getAdminTelegramIds(env: Record<string, string | undefined> = process.env): string[] {
  return (env.ADMIN_TELEGRAM_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^\d{1,20}$/.test(s));
}

/** Sends a plain-text Telegram message through the existing Onfile bot. Never throws. */
export async function sendTelegramMessage(chatId: string, text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 3500), disable_web_page_preview: true }),
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export interface AlertInput {
  providerId?: number | null;
  eventType: string;
  severity: Severity;
  message: string;
  details?: Record<string, unknown>;
  /** Alerts with the same key are sent at most once per cooldown window. */
  dedupeKey?: string;
  /** Notify admins on Telegram (default true for warning+). */
  notify?: boolean;
  cooldownMinutes?: number;
}

/**
 * Records an event and — unless an identical alert (same dedupeKey) was already
 * delivered within the cooldown — notifies admins through the Telegram bot.
 */
export async function raiseAlert(input: AlertInput): Promise<{ notified: boolean; suppressed: boolean }> {
  const notify = input.notify ?? input.severity !== "info";
  let suppressed = false;
  let notified = false;

  if (notify && input.dedupeKey) {
    const settings = await getSettings();
    const cooldown = input.cooldownMinutes ?? settings.alertCooldownMinutes;
    const since = new Date(Date.now() - cooldown * 60_000);
    const [recent] = await db
      .select({ id: storageProviderEvents.id })
      .from(storageProviderEvents)
      .where(
        and(
          eq(storageProviderEvents.dedupeKey, input.dedupeKey),
          eq(storageProviderEvents.notified, true),
          gt(storageProviderEvents.createdAt, since)
        )
      )
      .orderBy(desc(storageProviderEvents.createdAt))
      .limit(1);
    suppressed = !!recent;
  }

  if (notify && !suppressed) {
    const ids = getAdminTelegramIds();
    const icon = input.severity === "critical" ? "🚨" : input.severity === "error" ? "❗" : input.severity === "warning" ? "⚠️" : "ℹ️";
    const results = await Promise.all(ids.map((id) => sendTelegramMessage(id, `${icon} Onfile storage\n${input.message}`)));
    notified = results.some(Boolean);
  }

  await db.insert(storageProviderEvents).values({
    providerId: input.providerId ?? null,
    eventType: input.eventType,
    severity: input.severity,
    message: input.message.slice(0, 1000),
    details: input.details ?? {},
    dedupeKey: input.dedupeKey ?? null,
    notified,
  });

  return { notified, suppressed };
}

/** Event-only log entry (never notifies). */
export async function logEvent(input: Omit<AlertInput, "notify" | "dedupeKey">): Promise<void> {
  await raiseAlert({ ...input, notify: false });
}
