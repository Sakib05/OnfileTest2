import { sql } from "drizzle-orm";
import { db } from "@/db";
import { rateLimit as memoryRateLimit } from "@/lib/rateLimit";

/**
 * Cross-instance fixed-window rate limiter backed by Postgres (the app's
 * existing database), so limits hold across Vercel serverless instances
 * without a paid Redis/KV dependency. Fails over to the in-memory limiter
 * if the database is unreachable (so an outage never blocks creators, while
 * still giving per-instance protection).
 *
 * Alternatives if volume grows: Upstash Redis / Vercel KV (free tiers exist,
 * lower latency, no table writes). The function signature can stay the same.
 */
export async function sharedRateLimit(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<{ allowed: boolean; remaining: number }> {
  try {
    const result = await db.execute(sql`
      INSERT INTO storage_rate_limits (key, window_start, count)
      VALUES (${key}, now(), 1)
      ON CONFLICT (key) DO UPDATE SET
        count = CASE WHEN storage_rate_limits.window_start < now() - make_interval(secs => ${windowSeconds})
                     THEN 1 ELSE storage_rate_limits.count + 1 END,
        window_start = CASE WHEN storage_rate_limits.window_start < now() - make_interval(secs => ${windowSeconds})
                     THEN now() ELSE storage_rate_limits.window_start END
      RETURNING count
    `);
    const count = Number((result.rows[0] as { count: number | string } | undefined)?.count ?? 1);
    return { allowed: count <= limit, remaining: Math.max(0, limit - count) };
  } catch {
    return memoryRateLimit(key, limit, windowSeconds * 1000);
  }
}
