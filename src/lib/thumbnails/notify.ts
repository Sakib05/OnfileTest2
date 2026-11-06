import { parseAdminIds } from "@/lib/adminAuth";

/** Best-effort Telegram DM to every admin. Never throws; never logs the bot token. */
export async function notifyAdmins(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  await Promise.all(
    parseAdminIds().map(async (chatId) => {
      try {
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text }),
          signal: AbortSignal.timeout(5000),
        });
      } catch {
        console.error("admin_notify_failed");
      }
    })
  );
}
