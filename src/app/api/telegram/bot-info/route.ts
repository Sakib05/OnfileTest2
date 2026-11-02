import { NextResponse } from "next/server";
import { getBotUsername } from "@/lib/telegramBot";

/**
 * Exposes only the bot's public `@username` (never the token, never any
 * other credential) so the Manual Connect guide can tell creators exactly
 * which bot to look for by its real handle instead of a hardcoded/guessed
 * name. Safe to call unauthenticated — a bot's username is public
 * information on Telegram.
 *
 * `miniAppShortName` is the (public) short name of the Direct Link Mini App
 * registered in @BotFather (/newapp), read from the OPTIONAL server env var
 * TELEGRAM_MINI_APP_SHORT_NAME. When it is unset the value is null and the
 * client simply keeps using normal https file links.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const miniAppShortName = process.env.TELEGRAM_MINI_APP_SHORT_NAME?.trim() || null;
  if (!botToken) {
    return NextResponse.json({ username: null, miniAppShortName: null });
  }
  try {
    const username = await getBotUsername(botToken);
    return NextResponse.json({ username, miniAppShortName });
  } catch {
    return NextResponse.json({ username: null, miniAppShortName: null });
  }
}
