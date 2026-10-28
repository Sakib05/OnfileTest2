import { NextRequest, NextResponse } from "next/server";
import { destroySessionByToken, SESSION_COOKIE_NAME, isSameOriginRequest } from "@/lib/auth";
import { SETUP_COOKIE_NAME } from "@/lib/setupToken";

export async function POST(req: NextRequest) {
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (token) {
    try {
      await destroySessionByToken(token);
    } catch {
      console.error("logout_failed");
    }
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE_NAME);
  res.cookies.delete(SETUP_COOKIE_NAME);
  return res;
}
