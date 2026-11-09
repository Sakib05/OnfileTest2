/**
 * Server-side configuration for thumbnail storage. Everything here is read
 * from environment variables at call time (never at import time) so unrelated
 * routes can import this module without needing DBByte to be configured.
 *
 * Required (all server-only — none are NEXT_PUBLIC_*):
 *   DBBYTE_API_KEY        secret API key (needs read+write+delete on the bucket)
 *   DBBYTE_BUCKET         bucket slug, e.g. "onfile-thumbnails" (must be a PUBLIC bucket
 *                         with CDN delivery enabled so images are served from the edge)
 *   DBBYTE_CDN_BASE_URL   public delivery prefix, e.g. https://cdn.dbbyte.com/<public-token>
 *                         (the <public-token> is part of every public image URL by design;
 *                         it is NOT the API key)
 * Optional:
 *   DBBYTE_API_BASE_URL   defaults to https://api.dbbyte.com
 *   ADMIN_TELEGRAM_IDS    comma-separated Telegram user ids allowed to open the admin storage page
 *   THUMB_WARN_PCT / THUMB_HIGH_PCT / THUMB_BLOCK_PCT   usage thresholds (default 70 / 80 / 90)
 */

export interface DbbyteConfig {
  apiKey: string;
  bucket: string;
  cdnBaseUrl: string;
  apiBaseUrl: string;
}

/**
 * Environment values pasted into a hosting dashboard are frequently stored with
 * decoration that makes an otherwise-correct secret invalid: wrapping quotes,
 * trailing newlines/spaces, a leading "Bearer ", or the whole "NAME=value" line.
 * Any of these produces DBByte's "401 Invalid or revoked API key" even though
 * the same key works from curl. Normalise defensively; never log the value.
 */
export function normalizeEnvValue(raw: string | undefined, name?: string): string {
  let v = (raw ?? "").trim();
  if (name && v.toUpperCase().startsWith(`${name.toUpperCase()}=`)) v = v.slice(name.length + 1).trim();
  v = v.replace(/^["'`]+|["'`]+$/g, "").trim();
  v = v.replace(/^bearer\s+/i, "").trim();
  return v.replace(/[\r\n\t ]+/g, "");
}

export function getDbbyteConfig(env: NodeJS.ProcessEnv = process.env): DbbyteConfig | null {
  const apiKey = normalizeEnvValue(env.DBBYTE_API_KEY, "DBBYTE_API_KEY");
  const bucket = normalizeEnvValue(env.DBBYTE_BUCKET, "DBBYTE_BUCKET");
  const cdnBaseUrl = normalizeEnvValue(env.DBBYTE_CDN_BASE_URL, "DBBYTE_CDN_BASE_URL").replace(/\/+$/, "");
  if (!apiKey || !bucket || !cdnBaseUrl) return null;
  return {
    apiKey,
    bucket,
    cdnBaseUrl,
    apiBaseUrl: (normalizeEnvValue(env.DBBYTE_API_BASE_URL, "DBBYTE_API_BASE_URL") || "https://api.dbbyte.com").replace(/\/+$/, ""),
  };
}

/**
 * Public delivery URL for an object key:
 *   {DBBYTE_CDN_BASE_URL}/{bucket}/{objectKey}
 * (documented format: https://cdn.dbbyte.com/{public-token}/{bucket-name}/{file-name}).
 * Returns null when thumbnails are not configured, so callers fall back to icons.
 */
export function buildThumbnailUrl(objectKey: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const cfg = getDbbyteConfig(env);
  if (!cfg) return null;
  return `${cfg.cdnBaseUrl}/${encodeURIComponent(cfg.bucket)}/${encodeURIComponent(objectKey)}`;
}

export interface UsageThresholds {
  warn: number;
  high: number;
  block: number;
}

export function getUsageThresholds(env: NodeJS.ProcessEnv = process.env): UsageThresholds {
  const num = (v: string | undefined, d: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 && n <= 100 ? n : d;
  };
  const t = {
    warn: num(env.THUMB_WARN_PCT, 70),
    high: num(env.THUMB_HIGH_PCT, 80),
    block: num(env.THUMB_BLOCK_PCT, 90),
  };
  // Keep them ordered even if misconfigured.
  if (t.high < t.warn) t.high = t.warn;
  if (t.block < t.high) t.block = t.high;
  return t;
}
