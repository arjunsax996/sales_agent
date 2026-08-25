// Review reasons are a mix of fixed strings (triage.ts, guardrail-critic.ts)
// and free-text the LLM wrote itself (price-skus.ts) — inconsistent casing,
// no shared vocabulary. Bucket them into a handful of coarse categories by
// keyword so a reviewer can see *why* things are flagged in aggregate,
// instead of reading 900 individual sentences.
const CATEGORIES: { label: string; test: (reason: string) => boolean }[] = [
  { label: "Grade ordering / unrecognized grade", test: (r) => /grade_rank|priced above/i.test(r) },
  { label: "Margin below floor", test: (r) => /margin/i.test(r) && /floor/i.test(r) },
  { label: "Price swing over 30%", test: (r) => /swing cap/i.test(r) },
  { label: "Win rate extreme", test: (r) => /win rate/i.test(r) },
  { label: "Cost spike", test: (r) => /cost (change|increase)/i.test(r) },
  { label: "Missing/invalid pricing data", test: (r) => /last-year price|invalid margin|did not return/i.test(r) },
];

export function categorizeReviewReason(reason: string | null | undefined): string {
  if (!reason) return "Unspecified";
  for (const category of CATEGORIES) {
    if (category.test(reason)) return category.label;
  }
  return "Other";
}
