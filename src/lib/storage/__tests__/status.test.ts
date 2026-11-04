import { describe, expect, it } from "vitest";
import { currentPeriodStart, evaluateStatus, usagePercents, type StatusInput } from "../status";
import { DEFAULT_SETTINGS } from "../types";

const input = (over: Partial<StatusInput> = {}): StatusInput => ({
  enabled: true,
  status: "ACTIVE",
  quotaErrorAt: null,
  billingPeriodStart: null,
  storageQuota: 1000,
  storageUsed: 0,
  bandwidthQuota: 1000,
  bandwidthUsed: 0,
  requestQuota: null,
  requestUsed: 0,
  ...over,
});

describe("evaluateStatus", () => {
  it("uses 80% / 90% default thresholds", () => {
    expect(evaluateStatus(input({ storageUsed: 790 }), DEFAULT_SETTINGS).status).toBe("ACTIVE");
    expect(evaluateStatus(input({ storageUsed: 800 }), DEFAULT_SETTINGS).status).toBe("NEAR_LIMIT");
    expect(evaluateStatus(input({ storageUsed: 900 }), DEFAULT_SETTINGS).status).toBe("EXHAUSTED");
  });
  it("tracks storage, bandwidth and requests separately", () => {
    const p = usagePercents(input({ storageUsed: 100, bandwidthUsed: 950, requestQuota: 10, requestUsed: 1 }));
    expect(p.storage).toBe(10);
    expect(p.bandwidth).toBe(95);
    expect(p.requests).toBe(10);
    expect(evaluateStatus(input({ storageUsed: 100, bandwidthUsed: 950 }), DEFAULT_SETTINGS).status).toBe("EXHAUSTED");
  });
  it("honours configurable thresholds", () => {
    expect(evaluateStatus(input({ storageUsed: 600 }), { ...DEFAULT_SETTINGS, warnPercent: 50, criticalPercent: 70 }).status).toBe("NEAR_LIMIT");
  });
  it("keeps sticky states and disabled flag", () => {
    expect(evaluateStatus(input({ status: "DRAINING" }), DEFAULT_SETTINGS).status).toBe("DRAINING");
    expect(evaluateStatus(input({ status: "ERROR" }), DEFAULT_SETTINGS).status).toBe("ERROR");
    expect(evaluateStatus(input({ enabled: false }), DEFAULT_SETTINGS).status).toBe("DISABLED");
  });
  it("treats a recent provider quota error as EXHAUSTED until the period renews", () => {
    const now = new Date("2026-03-10T00:00:00Z");
    expect(evaluateStatus(input({ quotaErrorAt: new Date("2026-03-09T00:00:00Z"), billingPeriodStart: new Date("2026-03-01T00:00:00Z") }), DEFAULT_SETTINGS, now).status).toBe("EXHAUSTED");
    expect(evaluateStatus(input({ quotaErrorAt: new Date("2026-02-20T00:00:00Z"), billingPeriodStart: new Date("2026-03-01T00:00:00Z") }), DEFAULT_SETTINGS, now).status).toBe("ACTIVE");
  });
});

describe("currentPeriodStart", () => {
  it("follows the configured billing cycle, not the 1st of the month", () => {
    expect(currentPeriodStart(15, new Date("2026-03-20T00:00:00Z"))?.toISOString()).toBe("2026-03-15T00:00:00.000Z");
    expect(currentPeriodStart(15, new Date("2026-03-10T00:00:00Z"))?.toISOString()).toBe("2026-02-15T00:00:00.000Z");
  });
  it("returns null when the cycle is unknown (no automatic reset)", () => {
    expect(currentPeriodStart(null)).toBeNull();
  });
});
