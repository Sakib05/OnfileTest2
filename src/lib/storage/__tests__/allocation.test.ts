import { describe, expect, it } from "vitest";
import { allocate, type AllocationCandidate } from "../allocation";
import { DEFAULT_SETTINGS, type ProviderKey } from "../types";

const GB = 1_000_000_000;
const base = (key: ProviderKey, over: Partial<AllocationCandidate> = {}): AllocationCandidate => ({
  providerKey: key,
  providerId: 1,
  enabled: true,
  configured: true,
  status: "ACTIVE",
  termsStatus: "AMBIGUOUS",
  weight: 1,
  maxAssets: null,
  assetCount: 0,
  storageQuota: 10 * GB,
  storageUsed: 0,
  bandwidthQuota: 50 * GB,
  bandwidthUsed: 0,
  requestQuota: null,
  requestUsed: 0,
  consecutiveUploadFailures: 0,
  consecutiveDeliveryFailures: 0,
  ...over,
});

const all4 = (over: Partial<Record<ProviderKey, Partial<AllocationCandidate>>> = {}) =>
  (["imagekit", "cloudinary", "supabase", "dbbyte"] as ProviderKey[]).map((k, i) => base(k, { providerId: i + 1, ...over[k] }));

function simulate(cands: AllocationCandidate[], n = 4000) {
  const counts: Record<string, number> = {};
  for (let i = 0; i < n; i++) {
    const r = allocate(cands, DEFAULT_SETTINGS, { assetBytes: 100_000, seed: `seed-${i}` });
    if (r.chosen) counts[r.chosen] = (counts[r.chosen] ?? 0) + 1;
  }
  return counts;
}

describe("allocate", () => {
  it("distributes uploads across all four providers (not a fixed split, not sequential)", () => {
    const counts = simulate(all4());
    for (const k of ["imagekit", "cloudinary", "supabase", "dbbyte"]) expect(counts[k]).toBeGreaterThan(600);
  });

  it("gives providers with more headroom more uploads", () => {
    const counts = simulate(all4({ supabase: { storageQuota: 1 * GB, bandwidthQuota: 5 * GB, storageUsed: 0.5 * GB }, dbbyte: { storageQuota: 20 * GB, bandwidthQuota: 100 * GB } }));
    expect(counts.dbbyte).toBeGreaterThan(counts.supabase * 2);
  });

  it("reduces allocation for a provider at/over the warning threshold", () => {
    const healthy = simulate(all4());
    const warned = simulate(all4({ imagekit: { storageUsed: 8.4 * GB } }));
    expect(warned.imagekit ?? 0).toBeLessThan(healthy.imagekit * 0.35);
  });

  it("excludes providers at the critical threshold, exhausted, draining, disabled, error and unconfigured", () => {
    const cands = all4({
      imagekit: { storageUsed: 9.2 * GB },
      cloudinary: { status: "EXHAUSTED" },
      supabase: { enabled: false, status: "DISABLED" },
      dbbyte: { status: "ERROR" },
    });
    const r = allocate(cands, DEFAULT_SETTINGS, { assetBytes: 1000, seed: "x" });
    expect(r.order).toEqual([]);
    expect(r.excluded.map((e) => e.providerKey).sort()).toEqual(["cloudinary", "dbbyte", "imagekit", "supabase"]);
    expect(allocate(all4({ dbbyte: { status: "DRAINING" } }), DEFAULT_SETTINGS, { assetBytes: 1, seed: "y" }).order).not.toContain("dbbyte");
    expect(allocate(all4({ dbbyte: { configured: false } }), DEFAULT_SETTINGS, { assetBytes: 1, seed: "y" }).order).not.toContain("dbbyte");
  });

  it("never allocates to a provider with unknown storage or bandwidth quota", () => {
    const r = allocate(all4({ imagekit: { storageQuota: null }, cloudinary: { bandwidthQuota: null } }), DEFAULT_SETTINGS, { assetBytes: 1, seed: "u" });
    expect(r.order).not.toContain("imagekit");
    expect(r.order).not.toContain("cloudinary");
    expect(r.excluded.find((e) => e.providerKey === "imagekit")?.reasons).toContain("unknown_storage_quota");
    expect(r.excluded.find((e) => e.providerKey === "cloudinary")?.reasons).toContain("unknown_bandwidth_quota");
  });

  it("tracks request quota separately (request exhaustion excludes even with free storage)", () => {
    const r = allocate(all4({ dbbyte: { requestQuota: 10_000, requestUsed: 9_600 } }), DEFAULT_SETTINGS, { assetBytes: 1, seed: "r" });
    expect(r.order).not.toContain("dbbyte");
  });

  it("excludes prohibited commercial terms and honours max assets", () => {
    const r = allocate(all4({ imagekit: { termsStatus: "PROHIBITED" }, supabase: { maxAssets: 5, assetCount: 5 } }), DEFAULT_SETTINGS, { assetBytes: 1, seed: "t" });
    expect(r.order).not.toContain("imagekit");
    expect(r.order).not.toContain("supabase");
  });

  it("is deterministic for the same inputs and seed, and records an explanation", () => {
    const a = allocate(all4(), DEFAULT_SETTINGS, { assetBytes: 5000, seed: "same" });
    const b = allocate(all4(), DEFAULT_SETTINGS, { assetBytes: 5000, seed: "same" });
    expect(a).toEqual(b);
    expect(a.summary).toContain("seed=same");
    expect(a.summary).toContain(`selected ${a.chosen}`);
  });

  it("returns a failover order with every eligible provider exactly once", () => {
    const r = allocate(all4(), DEFAULT_SETTINGS, { assetBytes: 1, seed: "f" });
    expect(new Set(r.order).size).toBe(4);
    expect(r.order[0]).toBe(r.chosen);
  });

  it("penalises providers with recent failures and supports caller exclusion", () => {
    const healthy = simulate(all4());
    const flaky = simulate(all4({ dbbyte: { consecutiveUploadFailures: 4 } }));
    expect(flaky.dbbyte ?? 0).toBeLessThan(healthy.dbbyte * 0.4);
    expect(allocate(all4(), DEFAULT_SETTINGS, { assetBytes: 1, seed: "e", exclude: ["imagekit"] }).order).not.toContain("imagekit");
  });
});
