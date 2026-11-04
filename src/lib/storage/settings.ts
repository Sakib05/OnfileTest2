import { eq } from "drizzle-orm";
import { db } from "@/db";
import { storageSettings } from "@/db/schema";
import { DEFAULT_SETTINGS, type StorageSettings } from "./types";

const SETTINGS_KEY = "settings";

export async function getSettings(): Promise<StorageSettings> {
  const [row] = await db.select().from(storageSettings).where(eq(storageSettings.key, SETTINGS_KEY)).limit(1);
  const stored = row && row.value && typeof row.value === "object" ? (row.value as Partial<StorageSettings>) : {};
  return sanitizeSettings({ ...DEFAULT_SETTINGS, ...stored });
}

type NumRule = { min: number; max: number; int?: boolean };
const RULES: Partial<Record<keyof StorageSettings, NumRule>> = {
  warnPercent: { min: 1, max: 99 },
  criticalPercent: { min: 2, max: 100 },
  safetyMarginPercent: { min: 0, max: 50 },
  nearLimitWeightFactor: { min: 0, max: 1 },
  maxUploadProviderAttempts: { min: 1, max: 4, int: true },
  maxRetriesPerProvider: { min: 1, max: 5, int: true },
  maxRetryAfterMs: { min: 0, max: 20000, int: true },
  signedUrlTtlSeconds: { min: 30, max: 3600, int: true },
  migrationBatchSize: { min: 1, max: 200, int: true },
  migrationJobsPerRun: { min: 1, max: 50, int: true },
  migrationMaxRetries: { min: 1, max: 20, int: true },
  alertCooldownMinutes: { min: 1, max: 10080, int: true },
  repeatedFailureThreshold: { min: 1, max: 50, int: true },
};

/** Clamps stored values back into safe ranges (defends against bad manual edits). */
export function sanitizeSettings(s: StorageSettings): StorageSettings {
  const out: StorageSettings = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof StorageSettings)[]) {
    const def = DEFAULT_SETTINGS[key];
    const val = s[key];
    if (typeof def === "boolean") {
      (out as unknown as Record<string, unknown>)[key] = typeof val === "boolean" ? val : def;
    } else {
      const rule = RULES[key];
      let n = typeof val === "number" && Number.isFinite(val) ? val : (def as number);
      if (rule) {
        n = Math.min(rule.max, Math.max(rule.min, n));
        if (rule.int) n = Math.round(n);
      }
      (out as unknown as Record<string, unknown>)[key] = n;
    }
  }
  if (out.criticalPercent <= out.warnPercent) out.criticalPercent = Math.min(100, out.warnPercent + 1);
  return out;
}

export class SettingsValidationError extends Error {}

export async function updateSettings(patch: Record<string, unknown>): Promise<StorageSettings> {
  const current = await getSettings();
  const next: StorageSettings = { ...current };
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in DEFAULT_SETTINGS)) throw new SettingsValidationError(`Unknown setting: ${k}`);
    const key = k as keyof StorageSettings;
    if (typeof DEFAULT_SETTINGS[key] === "boolean") {
      if (typeof v !== "boolean") throw new SettingsValidationError(`${k} must be a boolean`);
      (next as unknown as Record<string, unknown>)[k] = v;
    } else {
      const rule = RULES[key];
      if (typeof v !== "number" || !Number.isFinite(v) || (rule && (v < rule.min || v > rule.max))) {
        throw new SettingsValidationError(`${k} must be a number between ${rule?.min} and ${rule?.max}`);
      }
      (next as unknown as Record<string, unknown>)[k] = v;
    }
  }
  if (next.criticalPercent <= next.warnPercent) throw new SettingsValidationError("criticalPercent must be greater than warnPercent");
  await db
    .insert(storageSettings)
    .values({ key: SETTINGS_KEY, value: next })
    .onConflictDoUpdate({ target: storageSettings.key, set: { value: next, updatedAt: new Date() } });
  return next;
}
