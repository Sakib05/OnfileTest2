import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { notifications, transactions, users, withdrawals } from "@/db/schema";
import { createSession } from "@/lib/auth";
import { POST } from "./route";
import { GET as WALLET } from "../route";

/**
 * DATABASE-BACKED integration test (real Postgres, real route handlers, real session cookies) of the $10 minimum and
 * the transactional balance handling. Needs a DEV database with the schema applied. No payment provider is involved.
 */

// Rate limiting is covered elsewhere; here many requests per user are sent on purpose.
vi.mock("@/lib/rateLimit", () => ({ getClientIp: () => "test", rateLimit: () => ({ allowed: true, remaining: 99 }) }));

const tag = `wd${Date.now()}`;
const created: number[] = [];
let n = 0;

async function makeUser(balance: string) {
  n += 1;
  const [u] = await db
    .insert(users)
    .values({ telegramId: `${tag}-${n}`, referralCode: `${tag}${n}`.slice(-8).toUpperCase(), balance })
    .returning();
  created.push(u.id);
  const s = await createSession(u.id);
  return { id: u.id, token: s.token };
}

let ipN = 0;
function post(token: string | null, json: unknown, extra: Record<string, string> = {}) {
  ipN += 1;
  const headers: Record<string, string> = {
    host: "localhost",
    "content-type": "application/json",
    "x-forwarded-for": `10.77.${Math.floor(ipN / 250)}.${ipN % 250}`,
    ...extra,
  };
  if (token) headers.cookie = `onfile_session=${token}`;
  return POST(new NextRequest("http://localhost/api/wallet/withdraw", { method: "POST", headers, body: JSON.stringify(json) }));
}

const ADDR = "TXyz1234567890abcdefGHIJ";
const state = async (id: number) => {
  const [u] = await db.select().from(users).where(eq(users.id, id));
  const wds = await db.select().from(withdrawals).where(eq(withdrawals.userId, id));
  const txs = await db.select().from(transactions).where(eq(transactions.userId, id));
  return { balance: u.balance, pending: u.pendingBalance, wds, txs };
};

afterAll(async () => {
  if (!created.length) return;
  await db.delete(notifications).where(inArray(notifications.userId, created));
  await db.delete(transactions).where(inArray(transactions.userId, created));
  await db.delete(withdrawals).where(inArray(withdrawals.userId, created));
  await db.delete(users).where(inArray(users.id, created));
});

describe("POST /api/wallet/withdraw — $10 minimum (server-side)", () => {
  let u: { id: number; token: string };
  beforeAll(async () => {
    u = await makeUser("100");
  });

  it("rejects $9.99 with the minimum message and deducts nothing", async () => {
    const res = await post(u.token, { amount: "9.99", walletAddress: ADDR, network: "TRC20", currency: "USDT" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Minimum withdrawal amount is $10.");
    expect(body.code).toBe("below_minimum");
    const s = await state(u.id);
    expect(Number(s.balance)).toBe(100);
    expect(Number(s.pending)).toBe(0);
    expect(s.wds).toHaveLength(0);
    expect(s.txs).toHaveLength(0);
  });

  it("rejects numeric (non-string) JSON amounts below $10 sent directly to the API", async () => {
    for (const amount of [9.99, 0.5, 1, 9.999999]) {
      const res = await post(u.token, { amount, walletAddress: ADDR });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("Minimum withdrawal amount is $10.");
    }
    expect(Number((await state(u.id)).balance)).toBe(100);
  });

  it("rejects malformed amounts and unsupported currency/network without touching the balance", async () => {
    for (const amount of ["abc", "-20", "1e2", "NaN", "10.0000001", ["20"], { v: 20 }]) {
      const res = await post(u.token, { amount, walletAddress: ADDR });
      expect(res.status).toBe(400);
    }
    expect((await post(u.token, { amount: "20", walletAddress: ADDR, currency: "BTC" })).status).toBe(400);
    expect((await post(u.token, { amount: "20", walletAddress: ADDR, network: "SOLANA" })).status).toBe(400);
    expect((await post(u.token, { amount: "20", walletAddress: "bad addr" })).status).toBe(400);
    const s = await state(u.id);
    expect(Number(s.balance)).toBe(100);
    expect(s.wds).toHaveLength(0);
  });

  it("requires authentication", async () => {
    expect((await post(null, { amount: "20", walletAddress: ADDR })).status).toBe(401);
  });

  it("accepts exactly $10.00 and debits exactly 10", async () => {
    const res = await post(u.token, { amount: "10.00", walletAddress: ADDR, network: "TRC20", currency: "USDT" });
    expect(res.status).toBe(201);
    const s = await state(u.id);
    expect(s.balance).toBe("90.000000");
    expect(s.pending).toBe("10.000000");
    expect(s.wds).toHaveLength(1);
    expect(s.wds[0]).toMatchObject({ status: "pending", currency: "USDT", network: "TRC20" });
    expect(Number(s.wds[0].amount)).toBe(10);
    expect(s.txs.filter((t) => t.type === "withdrawal")).toHaveLength(1);
  });

  it("accepts $10.01 with exact decimal arithmetic (no float drift)", async () => {
    const res = await post(u.token, { amount: 10.01, walletAddress: "TOther1234567890abcdefXYZ" });
    expect(res.status).toBe(201);
    const s = await state(u.id);
    expect(s.balance).toBe("79.990000");
    expect(s.pending).toBe("20.010000");
  });

  it("blocks an identical repeat request (duplicate guard) and leaves the balance alone", async () => {
    const res = await post(u.token, { amount: "10.01", walletAddress: "TOther1234567890abcdefXYZ" });
    expect(res.status).toBe(409);
    const s = await state(u.id);
    expect(s.balance).toBe("79.990000");
    expect(s.wds).toHaveLength(2);
  });

  it("existing history endpoint still lists withdrawals and transactions", async () => {
    const res = await WALLET(new NextRequest("http://localhost/api/wallet", { headers: { cookie: `onfile_session=${u.token}` } }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.withdrawals).toHaveLength(2);
    expect(body.transactions.length).toBe(2);
  });
});

describe("balance protection", () => {
  it("rejects amounts above the available balance (and a balance under $10 can never withdraw)", async () => {
    const poor = await makeUser("9.50");
    const r1 = await post(poor.token, { amount: "10", walletAddress: ADDR });
    expect(r1.status).toBe(400);
    expect((await r1.json()).error).toBe("Insufficient balance");
    const rich = await makeUser("15");
    const r2 = await post(rich.token, { amount: "15.01", walletAddress: ADDR });
    expect(r2.status).toBe(400);
    expect((await state(poor.id)).balance).toBe("9.500000");
    expect((await state(rich.id)).balance).toBe("15.000000");
    expect((await state(rich.id)).wds).toHaveLength(0);
  });

  it("concurrent requests can never overdraw: only one of two $10 requests succeeds on a $15 balance", async () => {
    const c = await makeUser("15");
    const [a, b] = await Promise.all([
      post(c.token, { amount: "10", walletAddress: "TConcurrentAddressNumberOne1" }),
      post(c.token, { amount: "10", walletAddress: "TConcurrentAddressNumberTwo2" }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 400]);
    const s = await state(c.id);
    expect(s.balance).toBe("5.000000");
    expect(s.pending).toBe("10.000000");
    expect(s.wds).toHaveLength(1);
  });
});
