import { NextResponse } from "next/server";
import { getBotUsername } from "@/lib/telegramBot";

/**
 * Exposes only the bot's public `@username` (never the token, never any
 * other credential) so the Manual Connect guide can tell creators exactly
 * which bot to look for by its real handle instead of a hardcoded/guessed
 * name. Safe to call unauthenticated — a bot's username is public
 * information on Telegram.
 */
export async function GET() {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    return NextResponse.json({ username: null });
  }
  try {
    const username = await getBotUsername(botToken);
    return NextResponse.json({ username });
  } catch {
    return NextResponse.json({ username: null });
  }
}
