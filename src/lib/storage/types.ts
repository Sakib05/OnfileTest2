/**
 * Provider-independent types for the multi-provider THUMBNAIL storage system.
 *
 * Only optional thumbnail images are ever sent to external providers. The
 * real digital files stay in creators' private Telegram channels.
 */

export const PROVIDER_KEYS = ["imagekit", "cloudinary", "supabase", "dbbyte"] as const;
export type ProviderKey = (typeof PROVIDER_KEYS)[number];

export const PROVIDER_LABELS: Record<ProviderKey, string> = {
  imagekit: "ImageKit",
  cloudinary: "Cloudinary",
  supabase: "Supabase Storage",
  dbbyte: "DBByte",
};

export function isProviderKey(value: unknown): value is ProviderKey {
  return typeof value === "string" && (PROVIDER_KEYS as readonly string[]).includes(value);
}

export type ProviderStatus = "ACTIVE" | "NEAR_LIMIT" | "EXHAUSTED" | "DRAINING" | "DISABLED" | "ERROR";
export type UsageSource = "OFFICIAL_API" | "MANUAL" | "ESTIMATED" | "UNKNOWN";
export type TermsStatus = "UNREVIEWED" | "PERMITTED" | "AMBIGUOUS" | "PROHIBITED";

/** Explicit "this provider cannot do that" result (never pretend to work). */
export type CapabilityResult<T> = { supported: true; value: T } | { supported: false; reason: string };

export function supported<T>(value: T): CapabilityResult<T> {
  return { supported: true, value };
}
export function unsupported<T = never>(reason: string): CapabilityResult<T> {
  return { supported: false, reason };
}

/** Reference to an object stored at a provider (persisted in thumbnail_assets). */
export interface ObjectRef {
  objectKey: string;
  deliveryMetadata: Record<string, unknown>;
}

export interface UploadInput {
  buffer: Buffer;
  mimeType: string;
  /** Unique, server-generated, path-safe object name (never user supplied). */
  objectName: string;
  checksum: string;
}

export interface UploadResult extends ObjectRef {
  size: number;
}

export interface ObjectMetadata {
  size?: number;
  mimeType?: string;
  width?: number;
  height?: number;
}

export interface DeliveryUrl {
  url: string;
  /** Moment the provider itself stops honouring the URL (null = never). */
  expiresAt: Date | null;
  /**
   * false => the URL carries non-expiring access and MUST NOT be sent to
   * browsers. Onfile fetches it server-side and streams the bytes instead.
   */
  clientSafe: boolean;
}

export interface HealthResult {
  ok: boolean;
  latencyMs: number;
  detail?: string;
  /** Set when the failure is an authentication/authorisation problem. */
  authFailure?: boolean;
  /** Free-form extra information (e.g. "bucket is public"). */
  warnings?: string[];
}

export interface UsageSnapshot {
  storageBytes?: number;
  storageQuotaBytes?: number;
  bandwidthBytes?: number;
  bandwidthCachedBytes?: number;
  bandwidthUncachedBytes?: number;
  bandwidthQuotaBytes?: number;
  requests?: number;
  requestQuota?: number;
  /** Provider-specific extras surfaced in the admin UI (e.g. Cloudinary credits). */
  extra?: Record<string, unknown>;
  periodStart?: Date;
}

export interface VerifyResult {
  ok: boolean;
  reason?: string;
}

export interface StorageAdapter {
  readonly key: ProviderKey;
  readonly displayName: string;
  /** true when every required credential/env var is present. */
  isConfigured(): boolean;
  upload(input: UploadInput): Promise<UploadResult>;
  /** Idempotent: deleting an already-missing object succeeds. */
  delete(ref: ObjectRef): Promise<void>;
  getMetadata(ref: ObjectRef): Promise<CapabilityResult<ObjectMetadata>>;
  getDeliveryUrl(ref: ObjectRef, opts: { expiresInSeconds: number }): Promise<CapabilityResult<DeliveryUrl>>;
  checkHealth(opts?: { deep?: boolean }): Promise<HealthResult>;
  getUsage(opts?: { periodStart?: Date }): Promise<CapabilityResult<UsageSnapshot>>;
  downloadForMigration(ref: ObjectRef): Promise<{ buffer: Buffer; mimeType: string }>;
  /** Re-reads the stored bytes and compares them with the expectation. */
  verifyObject(ref: ObjectRef, expected: { checksum: string; size: number }): Promise<VerifyResult>;
}

// ─── Provider errors ──────────────────────────────────────────────────────

export type ProviderErrorKind =
  | "rate_limited" // HTTP 429 / 420 with (or without) Retry-After
  | "server" // HTTP 5xx
  | "timeout"
  | "network"
  | "auth" // HTTP 401 / 403 — NEVER treated as quota exhaustion
  | "quota" // plan/storage quota exceeded
  | "not_found"
  | "conflict"
  | "bad_request"
  | "unknown";

export class ProviderError extends Error {
  constructor(
    public readonly kind: ProviderErrorKind,
    message: string,
    public readonly status?: number,
    public readonly retryAfterMs?: number
  ) {
    super(message);
    this.name = "ProviderError";
  }

  get retryable(): boolean {
    return this.kind === "rate_limited" || this.kind === "server" || this.kind === "timeout" || this.kind === "network";
  }
}

// ─── Settings ─────────────────────────────────────────────────────────────

export interface StorageSettings {
  /** Usage percentage at which a provider is NEAR_LIMIT (reduced allocation). */
  warnPercent: number;
  /** Usage percentage at which a provider is EXHAUSTED (no new uploads). */
  criticalPercent: number;
  /** Extra headroom (percent of quota) never allocated. */
  safetyMarginPercent: number;
  /** Allocation weight multiplier applied to NEAR_LIMIT / >=warn providers. */
  nearLimitWeightFactor: number;
  /** How many providers may be tried for a single upload. */
  maxUploadProviderAttempts: number;
  /** Max attempts per provider (429/5xx/timeouts) before failing over. */
  maxRetriesPerProvider: number;
  /** Longest Retry-After we are willing to sleep for inside a request. */
  maxRetryAfterMs: number;
  signedUrlTtlSeconds: number;
  migrationBatchSize: number;
  migrationJobsPerRun: number;
  migrationMaxRetries: number;
  migrationsPaused: boolean;
  alertCooldownMinutes: number;
  /** Consecutive upload failures after which a "repeated failures" alert fires. */
  repeatedFailureThreshold: number;
}

export const DEFAULT_SETTINGS: StorageSettings = {
  warnPercent: 80,
  criticalPercent: 90,
  safetyMarginPercent: 5,
  nearLimitWeightFactor: 0.25,
  maxUploadProviderAttempts: 4,
  maxRetriesPerProvider: 3,
  maxRetryAfterMs: 5000,
  signedUrlTtlSeconds: 300,
  migrationBatchSize: 25,
  migrationJobsPerRun: 10,
  migrationMaxRetries: 5,
  migrationsPaused: false,
  alertCooldownMinutes: 360,
  repeatedFailureThreshold: 3,
};

export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
