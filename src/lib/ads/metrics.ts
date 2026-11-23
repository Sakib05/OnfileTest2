import type { CompletionReason, Objective, PricingModel } from "./constants";

/** CTR = clicks / impressions × 100, rounded to 2 decimals. `null` (not 0!) when nothing has been shown yet. */
export function ctr(clicks: number | null | undefined, impressions: number | null | undefined): number | null {
  const c = Number(clicks ?? 0);
  const i = Number(impressions ?? 0);
  if (!Number.isFinite(c) || !Number.isFinite(i) || i <= 0) return null;
  return Math.round((c / i) * 10_000) / 100;
}

export function toNumber(v: string | number | null | undefined): number {
  const n = typeof v === "number" ? v : parseFloat(v ?? "0");
  return Number.isFinite(n) ? n : 0;
}

export function remainingBudget(budget: string | number | null | undefined, spent: string | number | null | undefined): number {
  return Math.max(0, Math.round((toNumber(budget) - toNumber(spent)) * 1e6) / 1e6);
}

export interface CounterRow {
  impressions: number | null;
  clicks: number | null;
  verifiedJoins: number | null;
}

/** The counter that the campaign's objective is measured by. */
export function objectiveCount(objective: Objective | string | null | undefined, row: CounterRow): number {
  switch (objective) {
    case "clicks":
      return row.clicks ?? 0;
    case "verified_joins":
      return row.verifiedJoins ?? 0;
    case "impressions":
    default:
      return row.impressions ?? 0;
  }
}

/** Progress toward the target (0–100). `null` when the campaign has no target. */
export function targetProgress(
  objective: Objective | string | null | undefined,
  row: CounterRow,
  target: number | null | undefined
): { current: number; target: number; percent: number } | null {
  if (!target || target <= 0) return null;
  const current = objectiveCount(objective, row);
  return { current, target, percent: Math.min(100, Math.round((current / target) * 1000) / 10) };
}

/**
 * Cost of ONE unit of the priced event. cpm → price / 1000 per impression, cpc → per click, cpa → per verified join.
 * Returns 0 when pricing hasn't been set (nothing accrues without an admin-confirmed price) or the event isn't the priced one.
 */
export function eventCost(
  pricingModel: PricingModel | string | null | undefined,
  unitPrice: string | number | null | undefined,
  event: "impression" | "click" | "join"
): number {
  const price = toNumber(unitPrice);
  if (!pricingModel || price <= 0) return 0;
  const cost =
    pricingModel === "cpm" && event === "impression" ? price / 1000
    : pricingModel === "cpc" && event === "click" ? price
    : pricingModel === "cpa" && event === "join" ? price
    : 0;
  return Math.round(cost * 1e6) / 1e6;
}

export interface CompletionInput extends CounterRow {
  objective: string | null;
  budget: string | number | null;
  spent: string | number | null;
  targetAmount: number | null;
  endDate: Date | string | null;
}

/**
 * When must an active campaign be completed? Only rules whose tracking really exists are applied:
 *   target_reached   — the objective's counter reached the target
 *   budget_exhausted — recorded spend reached the budget (spend only accrues once an admin set a price)
 *   duration_ended   — the end date has passed
 */
export function completionReason(row: CompletionInput, now: Date = new Date()): CompletionReason | null {
  if (row.targetAmount && row.targetAmount > 0 && objectiveCount(row.objective, row) >= row.targetAmount) return "target_reached";
  const budget = toNumber(row.budget);
  if (budget > 0 && toNumber(row.spent) >= budget) return "budget_exhausted";
  if (row.endDate && new Date(row.endDate).getTime() < now.getTime()) return "duration_ended";
  return null;
}
