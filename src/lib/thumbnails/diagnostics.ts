/**
 * Safe, secret-free diagnostics for the DBByte thumbnail upload path.
 *
 * - Never returns/logs the API key or any substring/hash of it.
 * - Only boolean/length/hostname metadata is collected.
 * - Server-side only; never return these values from an API response or store them.
 */

export const DBBYTE_DIAGNOSTIC_PREFIX = "[ONFILE_DBBYTE_DIAGNOSTIC]";

export type DbbyteDiagnostics = {
  apiKeyPresent: boolean;
  apiKeyLength: number;
  startsWithDbk: boolean;
  hasQuotes: boolean;
  hasWhitespace: boolean;
  bucketPresent: boolean;
  bucket: string;
  apiHost: string;
  vercelEnv: string;
  gitCommitRef: string;
  gitCommitSha: string;
};

type EnvLike = Record<string, string | undefined>;

const DEFAULT_API_BASE_URL = "https://api.dbbyte.com";
const MAX_MESSAGE_LENGTH = 300;

/** Hostname only: never credentials, path or query string. */
export function safeHostname(baseUrl: string | undefined): string {
  try {
    return new URL(baseUrl || DEFAULT_API_BASE_URL).hostname || "invalid";
  } catch {
    return "invalid";
  }
}

/**
 * Collect diagnostics about what the runtime sees. Pass the values exactly as
 * config reads them (raw, before any trimming) so whitespace/quotes show up.
 */
export function collectDbbyteDiagnostics(input: {
  apiKey: string | undefined;
  bucket: string | undefined;
  apiBaseUrl?: string | undefined;
  env?: EnvLike;
}): DbbyteDiagnostics {
  const env = input.env ?? process.env;
  const key = input.apiKey ?? "";
  const bucket = input.bucket ?? "";
  return {
    apiKeyPresent: key.length > 0,
    apiKeyLength: key.length,
    startsWithDbk: key.startsWith("dbk"),
    hasQuotes: /^["'`]|["'`]$/.test(key),
    hasWhitespace: /\s/.test(key),
    bucketPresent: bucket.length > 0,
    bucket: bucket.slice(0, 100),
    apiHost: safeHostname(input.apiBaseUrl),
    vercelEnv: env.VERCEL_ENV ?? "unset",
    gitCommitRef: env.VERCEL_GIT_COMMIT_REF ?? "unset",
    gitCommitSha: (env.VERCEL_GIT_COMMIT_SHA ?? "unset").slice(0, 7),
  };
}

/** Redact the API key (raw, trimmed and unquoted forms) and bearer tokens. */
export function sanitizeDbbyteMessage(
  message: unknown,
  apiKey: string | undefined,
): string {
  let text = typeof message === "string" ? message : "";
  const raw = apiKey ?? "";
  const variants = new Set<string>();
  if (raw) {
    variants.add(raw);
    const trimmed = raw.trim();
    variants.add(trimmed);
    variants.add(trimmed.replace(/^["'`]+|["'`]+$/g, "").trim());
  }
  // Longest first so overlapping variants are fully redacted.
  for (const v of [...variants].filter(Boolean).sort((a, b) => b.length - a.length)) {
    text = text.split(v).join("[REDACTED]");
  }
  text = text.replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]");
  return text.length > MAX_MESSAGE_LENGTH
    ? `${text.slice(0, MAX_MESSAGE_LENGTH)}…`
    : text;
}

/** Log the config snapshot (call where DBByte config is read). */
export function logDbbyteConfigDiagnostics(
  diagnostics: DbbyteDiagnostics,
  log: (...args: unknown[]) => void = console.warn,
): void {
  log(DBBYTE_DIAGNOSTIC_PREFIX, JSON.stringify({ event: "config", ...diagnostics }));
}

/** Log an authentication failure (call where DBByte returns 401/403). */
export function logDbbyteAuthFailure(
  params: {
    status: number;
    message: unknown;
    apiKey: string | undefined;
    diagnostics: DbbyteDiagnostics;
    correlationId?: string;
  },
  log: (...args: unknown[]) => void = console.error,
): string {
  const correlationId =
    params.correlationId ?? `onfile-dbbyte-${crypto.randomUUID()}`;
  log(
    DBBYTE_DIAGNOSTIC_PREFIX,
    JSON.stringify({
      event: "auth_failure",
      correlationId,
      httpStatus: params.status,
      dbbyteMessage: sanitizeDbbyteMessage(params.message, params.apiKey),
      ...params.diagnostics,
    }),
  );
  return correlationId;
}
