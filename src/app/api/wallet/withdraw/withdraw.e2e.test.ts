import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { notifications, transactions, users, withdrawals } from "@/db/schema";
import { createSession } from "@/lib/auth";
import { POST } from "./route";

/**
 * DATABASE-BACKED integration test (real Postgres, the REAL route handler, real session cookies).
 * It does not talk to Telegram or to any payment network. Needs a disposable DB with the schema applied.
 */
const tag = `wd${Date.now()}`;
const ADDRESS = "TXyz1234567890abcdef";
const createdUsers: number[] = [];
let ipSeq = 0;

function post(token: string | undefined, body: unknown, opts: { raw?: string; origin?: string } = {}) {
  const headers: Record<string, string> = {
    host: "localhost",
    "content-type": "application/json",
    // a distinct IP per request so the per-IP rate limiter never interferes with what is being tested
    "x-forwarded-for": `10.88.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}`,
  };
  if (token) headers.cookie = `onfile_session=${token}`;
  if (opts.origin) headers.origin = opts.origin;
  return new NextRequest("http://localhost/api/wallet/withdraw", {
    method: "POST",
    headers,
    body: opts.raw ?? JSON.stringify(body),
  });
}

async function makeUser(n: string, balance: string) {
  const [u] = await db
    .insert(users)
    .values({ telegramId: `${tag}${n}`, referralCode: `${tag}${n}`.slice(-8).toUpperCase(), balance, pendingBalance: "0" })
    .returning();
  createdUsers.push(u.id);
  const s = await createSession(u.id);
  return { id: u.id, token: s.token };
}

async function state(userId: number) {
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  const wds = await db.select().from(withdrawals).where(eq(withdrawals.userId, userId));
  const txs = await db.select().from(transactions).where(eq(transactions.userId, userId));
  return { balance: u.balance, pending: u.pendingBalance, wds, txs };
}

const valid = (amount: unknown, extra: Record<string, unknown> = {}) => ({
  amount,
  walletAddress: ADDRESS,
  network: "TRC20",
  currency: "USDT",
  ...extra,
});

afterAll(async () => {
  for (const id of createdUsers) {
    await db.delete(notifications).where(eq(notifications.userId, id));
    await db.delete(transactions).where(eq(transactions.userId, id));
    await db.delete(withdrawals).where(eq(withdrawals.userId, id));
    await db.delete(users).where(eq(users.id, id)); // sessions cascade
  }
});

describe("POST /api/wallet/withdraw", () => {
  let a: { id: number; token: string };
  beforeAll(async () => {
    a = await makeUser("a", "100");
  });

  it("requires a session", async () => {
    const res = await POST(post(undefined, valid("10")));
    expect(res.status).toBe(401);
  });

  it("rejects a cross-origin request", async () => {
    const res = await POST(post(a.token, valid("10"), { origin: "https://evil.example" }));
    expect(res.status).toBe(403);
  });

  it("rejects a withdrawal below $10 and leaves the balance untouched", async () => {
    for (const amount of ["9.99", "9.999999", "1", 5, "0.5"]) {
      const res = await POST(post(a.token, valid(amount)));
      expect(res.status, String(amount)).toBe(400);
      const data = await res.json();
      expect(data.code).toBe("below_minimum");
      expect(data.error).toContain("$10 USD");
    }
    const s = await state(a.id);
    expect(Number(s.balance)).toBe(100);
    expect(Number(s.pending)).toBe(0);
    expect(s.wds).toHaveLength(0);
    expect(s.txs).toHaveLength(0);
  });

  it("rejects invalid, malformed, zero and negative amounts without side effects", async () => {
    for (const amount of ["0", "-10", "abc", "", null, "1e3", "10.1234567", "NaN", { x: 1 }, [10]]) {
      const res = await POST(post(a.token, valid(amount)));
      expect(res.status, JSON.stringify(amount)).toBe(400);
    }
    const missing = await POST(post(a.token, { walletAddress: ADDRESS }));
    expect(missing.status).toBe(400);
    const notJson = await POST(post(a.token, null, { raw: "{not json" }));
    expect(notJson.status).toBe(400);
    const s = await state(a.id);
    expect(Number(s.balance)).toBe(100);
    expect(s.wds).toHaveLength(0);
  });

  it("rejects unsupported currencies/networks and malformed addresses", async () => {
    expect((await POST(post(a.token, valid("10", { currency: "BTC" })))).status).toBe(400);
    expect((await POST(post(a.token, valid("10", { network: "SOLANA" })))).status).toBe(400);
    expect((await POST(post(a.token, valid("10", { walletAddress: "bad address with spaces" })))).status).toBe(400);
    expect((await state(a.id)).wds).toHaveLength(0);
  });

  it("accepts exactly $10: deducts from balance, moves it to pending, writes the withdrawal + ledger row", async () => {
    const res = await POST(post(a.token, valid("10")));
    expect(res.status).toBe(201);
    const { withdrawal } = await res.json();
    expect(withdrawal).toMatchObject({ userId: a.id, currency: "USDT", network: "TRC20", status: "pending", walletAddress: ADDRESS });
    expect(Number(withdrawal.amount)).toBe(10);
    const s = await state(a.id);
    expect(s.balance).toBe("90.000000");
    expect(s.pending).toBe("10.000000");
    expect(s.wds).toHaveLength(1);
    expect(s.txs).toHaveLength(1);
    expect(s.txs[0]).toMatchObject({ type: "withdrawal", status: "pending", referenceId: String(withdrawal.id) });
    const [n] = await db.select().from(notifications).where(eq(notifications.userId, a.id));
    expect(n.body).toContain("10.00 USDT");
  });

  it("accepts amounts above $10 with exact decimals (no float drift)", async () => {
    const res = await POST(post(a.token, valid("10.123457")));
    expect(res.status).toBe(201);
    const s = await state(a.id);
    expect(s.balance).toBe("79.876543");
    expect(s.pending).toBe("20.123457");
  });

  it("accepts every existing network", async () => {
    const u = await makeUser("nets", "100");
    for (const [i, network] of ["TRC20", "ERC20", "TON", "BEP20"].entries()) {
      const res = await POST(post(u.token, valid(String(10 + i), { network })));
      expect(res.status, network).toBe(201);
    }
    expect((await state(u.id)).balance).toBe("54.000000");
  });

  it("rejects insufficient balance and does not deduct", async () => {
    const u = await makeUser("poor", "12.5");
    const res = await POST(post(u.token, valid("12.500001")));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("insufficient_balance");
    const s = await state(u.id);
    expect(s.balance).toBe("12.500000");
    expect(s.pending).toBe("0.000000");
    expect(s.wds).toHaveLength(0);
    expect(s.txs).toHaveLength(0);
    // exactly the full balance is allowed
    expect((await POST(post(u.token, valid("12.5")))).status).toBe(201);
    expect((await state(u.id)).balance).toBe("0.000000");
  });

  it("a balance under $10 can never withdraw (even the whole balance)", async () => {
    const u = await makeUser("tiny", "9.5");
    const res = await POST(post(u.token, valid("9.5")));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("below_minimum");
    expect((await state(u.id)).balance).toBe("9.500000");
  });

  it("answers a duplicate submission (same request repeated) with 409 and does nothing", async () => {
    const u = await makeUser("dup", "100");
    expect((await POST(post(u.token, valid("15")))).status).toBe(201);
    const again = await POST(post(u.token, valid("15")));
    expect(again.status).toBe(409);
    expect((await again.json()).code).toBe("duplicate_request");
    const s = await state(u.id);
    expect(s.balance).toBe("85.000000");
    expect(s.wds).toHaveLength(1);
    // a genuinely different request is still accepted
    expect((await POST(post(u.token, valid("16")))).status).toBe(201);
    expect((await state(u.id)).balance).toBe("69.000000");
  });

  it("concurrent identical requests create exactly one withdrawal", async () => {
    const u = await makeUser("race1", "100");
    const results = await Promise.all(Array.from({ length: 8 }, () => POST(post(u.token, valid("20")))));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(7);
    const s = await state(u.id);
    expect(s.balance).toBe("80.000000");
    expect(s.pending).toBe("20.000000");
    expect(s.wds).toHaveLength(1);
    expect(s.txs).toHaveLength(1);
  });

  it("concurrent different requests can never overspend the balance", async () => {
    const u = await makeUser("race2", "35");
    // 10 different amounts (so none is a duplicate) of 10.01 … 10.10; only three of them fit in 35.
    const amounts = Array.from({ length: 10 }, (_, i) => (10.01 + i / 100).toFixed(2));
    const results = await Promise.all(amounts.map((amount) => POST(post(u.token, valid(amount)))));
    const created = results.filter((r) => r.status === 201).length;
    const rejected = results.filter((r) => r.status === 400).length;
    expect(created).toBe(3);
    expect(rejected).toBe(7);
    const s = await state(u.id);
    expect(s.wds).toHaveLength(3);
    expect(s.txs).toHaveLength(3);
    const spent = s.wds.reduce((sum, w) => sum + Math.round(Number(w.amount) * 1_000_000), 0);
    expect(Number(s.balance)).toBeGreaterThanOrEqual(0);
    // balance + pending is conserved exactly: nothing created or lost
    expect(Math.round(Number(s.balance) * 1_000_000) + Math.round(Number(s.pending) * 1_000_000)).toBe(35_000_000);
    expect(Math.round(Number(s.pending) * 1_000_000)).toBe(spent);
  });

  it("one user's request never affects another user's balance", async () => {
    const x = await makeUser("iso1", "50");
    const y = await makeUser("iso2", "50");
    expect((await POST(post(x.token, valid("20")))).status).toBe(201);
    expect((await state(y.id)).balance).toBe("50.000000");
  });
});
