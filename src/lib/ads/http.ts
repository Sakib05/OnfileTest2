import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser, isSameOriginRequest } from "@/lib/auth";
import { rateLimit } from "@/lib/rateLimit";
import type { User } from "@/db/schema";

export const NO_STORE = { "Cache-Control": "private, no-store" } as const;

export function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export function apiError(error: string, status: number, extra: Record<string, unknown> = {}) {
  return json({ error, ...extra }, status);
}

/**
 * Standard guard for every creator advertising endpoint: same-origin check for state changes, a per-user rate limit and
 * authentication from the server-side session. The user id is NEVER read from the request.
 */
export async function guardCreator(
  req: NextRequest,
  opts: { mutating: boolean; bucket: string; limit: number; windowMs?: number }
): Promise<{ user: User } | { response: NextResponse }> {
  if (opts.mutating && !isSameOriginRequest(req)) return { response: apiError("Invalid request origin", 403) };
  const user = await getSessionUser(req);
  if (!user) return { response: apiError("Unauthorized", 401) };
  const { allowed } = rateLimit(`ads:${opts.bucket}:${user.id}`, opts.limit, opts.windowMs ?? 60_000);
  if (!allowed) return { response: apiError("Too many requests. Please slow down.", 429) };
  return { user };
}

export async function readJson(req: NextRequest): Promise<unknown | null> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}
