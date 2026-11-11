/**
 * Single source of truth for the thumbnail size limit.
 *
 * 2 MiB = 2,097,152 bytes. Used by the file pickers, the browser-side
 * compressor, the staging/replace API routes and the server image pipeline, so
 * the client and the server can never disagree. This module is dependency-free
 * and safe to import from both client and server code.
 */
export const THUMBNAIL_MAX_BYTES = 2 * 1024 * 1024; // 2,097,152
/** User-facing wording ("Maximum 2 MB"). */
export const THUMBNAIL_MAX_LABEL = "2 MB";
/** Extra allowance (multipart boundaries/headers) for the cheap Content-Length pre-check only. */
export const MULTIPART_OVERHEAD_BYTES = 64 * 1024;
