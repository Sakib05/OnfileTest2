/**
 * Provider-neutral storage seam for thumbnails. The thumbnail service, the
 * staged-upload service and every API route talk ONLY to this interface; all
 * provider-specific code lives in one adapter file (today: ./dbbyte.ts) and is
 * selected in ./storage.ts. To add another provider implement this interface
 * and register it there — no UI or route changes are needed.
 */
export interface ThumbnailStorage {
  /** Short provider id persisted next to every object key (e.g. "dbbyte"). */
  readonly provider: string;
  /** Stores bytes under a NEW unique key. Resolves with the key actually stored. */
  put(key: string, body: Uint8Array, contentType: string): Promise<{ key: string }>;
  /** Deletes an object. A missing object (404) counts as success. */
  delete(key: string): Promise<void>;
}

export type StorageErrorCode =
  | "not_configured"
  | "auth" //            401/403: bad/revoked key, missing permission, wrong bucket
  | "rate_limited" //    429 with Retry-After (transient burst limit)
  | "quota_exceeded" //  429 without Retry-After (plan quota — retrying is useless)
  | "too_large" //       413
  | "conflict" //        409 (name already exists)
  | "timeout"
  | "network"
  | "server" //          5xx
  | "unverified" //      success response that does not match what we sent
  | "unknown";

export class StorageError extends Error {
  code: StorageErrorCode;
  status?: number;
  retryAfter?: number;
  constructor(code: StorageErrorCode, message: string, opts: { status?: number; retryAfter?: number } = {}) {
    super(message);
    this.name = "StorageError";
    this.code = code;
    this.status = opts.status;
    this.retryAfter = opts.retryAfter;
  }
}
