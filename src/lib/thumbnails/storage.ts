import { getDbbyteStorage } from "./dbbyte";
import type { ThumbnailStorage } from "./provider";

/**
 * Single place that decides WHICH storage provider is used. Everything else
 * (services, routes, UI) depends only on the `ThumbnailStorage` interface.
 *
 * Select with THUMBNAIL_STORAGE_PROVIDER (default "dbbyte"). To add a provider:
 * implement `ThumbnailStorage` in its own file and add a case below.
 * Returns null when the provider is unknown or not configured, so callers show
 * "storage unavailable" / fall back to default thumbnails instead of crashing.
 */
export function getThumbnailStorage(env: NodeJS.ProcessEnv = process.env): ThumbnailStorage | null {
  const provider = (env.THUMBNAIL_STORAGE_PROVIDER ?? "dbbyte").trim().toLowerCase() || "dbbyte";
  switch (provider) {
    case "dbbyte":
      return getDbbyteStorage(env);
    default:
      return null;
  }
}
