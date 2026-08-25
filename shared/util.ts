// Numeric/domain helpers shared by both agents (agent/ and quote-agent/).

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// (price, cost) -> margin as a percentage, e.g. 32.5 for 32.5%. A
// zero/negative price has no meaningful margin — fail toward "flag this",
// not toward a NaN that silently clears every downstream check.
export function marginPct(price: number, cost: number): number {
  if (price <= 0) return -Infinity;
  return ((price - cost) / price) * 100;
}

// (from, to) -> percentage change, e.g. pctChange(100, 120) === 20. Same
// fail-safe reasoning as marginPct: no baseline means "treat as maximally
// changed" rather than NaN.
export function pctChange(from: number, to: number): number {
  if (from === 0) return to === 0 ? 0 : Infinity;
  return ((to - from) / from) * 100;
}

// Grade seniority for a chemical family, low -> high. Used to catch pricing
// bugs like a "lower" grade priced above a "higher" one at the same pack size
// — this already exists in last year's data (e.g. Sodium Bicarbonate USP/NF
// priced above ACS Reagent) — and, in quote-agent, to pick a sensible default
// grade when a requester doesn't name one.
export const GRADE_RANK: Record<string, number> = {
  Technical: 0,
  Industrial: 1,
  "USP/NF": 2,
  "ACS Reagent": 3,
};
