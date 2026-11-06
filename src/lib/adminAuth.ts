import type { NextRequest, NextResponse } from "next/server";
import { NextResponse as Res } from "next/server";
import { requireSessionUser } from "@/lib/auth";
import type { User } from "@/db/schema";

/**
 * Admin = a creator whose VERIFIED session user has a Telegram id listed in the
 * ADMIN_TELEGRAM_IDS env var (comma-separated). The repository had no admin
 * system, so this is the smallest safe gate: identity comes only from the
 * server-side session (Telegram initData signature), never from the client.
 */
export function parseAdminIds(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.ADMIN_TELEGRAM_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isAdminUser(user: Pick<User, "telegramId"> | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!user?.telegramId) return false;
  return parseAdminIds(env).includes(user.telegramId);
}

export async function requireAdmin(req: NextRequest): Promise<{ user: User } | { response: NextResponse }> {
  const session = await requireSessionUser(req);
  if ("response" in session) return session;
  if (!isAdminUser(session.user)) {
    return { response: Res.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return session;
}
