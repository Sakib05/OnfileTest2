import { CloudinaryAdapter, cloudinaryConfigFromEnv } from "./cloudinary";
import { DBByteAdapter, dbbyteConfigFromEnv } from "./dbbyte";
import { ImageKitAdapter, imageKitConfigFromEnv } from "./imagekit";
import { SupabaseStorageAdapter, supabaseConfigFromEnv } from "./supabase";
import type { ProviderKey, StorageAdapter } from "../types";

type Env = Record<string, string | undefined>;

/**
 * Adapter registry. To add a provider: implement StorageAdapter, add its key
 * to PROVIDER_KEYS (types.ts) and register a factory here.
 */
const FACTORIES: Record<ProviderKey, (env: Env) => StorageAdapter> = {
  imagekit: (env) => new ImageKitAdapter(imageKitConfigFromEnv(env)),
  cloudinary: (env) => new CloudinaryAdapter(cloudinaryConfigFromEnv(env)),
  supabase: (env) => new SupabaseStorageAdapter(supabaseConfigFromEnv(env)),
  dbbyte: (env) => new DBByteAdapter(dbbyteConfigFromEnv(env)),
};

const cache = new Map<ProviderKey, StorageAdapter>();
const overrides = new Map<ProviderKey, StorageAdapter>();

export function createAdapter(key: ProviderKey, env: Env = process.env): StorageAdapter {
  return FACTORIES[key](env);
}

export function getAdapter(key: ProviderKey): StorageAdapter {
  const override = overrides.get(key);
  if (override) return override;
  let adapter = cache.get(key);
  if (!adapter) {
    adapter = createAdapter(key);
    cache.set(key, adapter);
  }
  return adapter;
}

/** Test seam: replace an adapter with a mock. Pass null to restore. */
export function setAdapterOverride(key: ProviderKey, adapter: StorageAdapter | null): void {
  if (adapter) overrides.set(key, adapter);
  else overrides.delete(key);
}

export function clearAdapterOverrides(): void {
  overrides.clear();
}
