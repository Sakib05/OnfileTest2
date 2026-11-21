import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, isSameOriginRequest, unauthorized } from "@/lib/auth";
import { getClientIp, rateLimit } from "@/lib/rateLimit";
import { createWithdrawalRequest } from "@/lib/withdrawals";

/**
 * Creates a withdrawal request. All validation (including the $10 minimum), the balance check and the debit are
 * enforced server-side in `createWithdrawalRequest` (src/lib/withdrawals.ts) inside one DB transaction.
 */
export async function POST(req: NextRequest) {
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const ip = getClientIp(req);
  const { allowed } = rateLimit(`withdraw:${ip}`, 10, 60_000);
  if (!allowed) {
    return NextResponse.json({ error: "Too many requests. Please try again shortly." }, { status: 429 });
  }

  try {
    const user = await getSessionUser(req);
    if (!user) return unauthorized();

    const perUser = rateLimit(`withdraw-user:${user.id}`, 5, 60_000);
    if (!perUser.allowed) {
      return NextResponse.json({ error: "Too many requests. Please try again shortly." }, { status: 429 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    const { amount, walletAddress, network, currency } = body as Record<string, unknown>;

    const result = await createWithdrawalRequest(user.id, { amount, walletAddress, network, currency });
    if (!result.ok) {
      return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
    }
    return NextResponse.json({ withdrawal: result.withdrawal }, { status: 201 });
  } catch (err) {
    console.error("withdraw_failed", err instanceof Error ? err.message : "unknown_error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
