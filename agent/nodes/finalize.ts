import type { RepricingStateT } from "../state";
import { log } from "../../shared/log";

/**
 * Merge the formulaic and LLM-reasoned recommendations into one list.
 * Reached either from a clean guardrail pass, or with guardrailIssues still
 * outstanding after the retry budget ran out (or with no retry available at
 * all, on the formulaic-only skip path) — in that case, force human review on
 * the affected SKUs rather than letting an unresolved issue ship silently.
 */
export function finalize(state: RepricingStateT): Partial<RepricingStateT> {
  const merged = [...state.formulaicRecommendations, ...state.skuRecommendations];
  if (state.guardrailIssues.length === 0) {
    log("finalize", `${state.baseChemical}: ${merged.length} recommendation(s), guardrails clean`);
    return { skuRecommendations: merged };
  }

  const flagged = new Map(state.guardrailIssues.map((issue) => [issue.sku, issue]));
  let newlyFlagged = 0;
  const finalized = merged.map((rec) => {
    const issue = flagged.get(rec.sku);
    if (!issue || rec.needsHumanReview) return rec;
    newlyFlagged++;
    return { ...rec, needsHumanReview: true, reviewReason: `Unresolved guardrail issue: ${issue.issue}` };
  });

  log(
    "finalize",
    `${state.baseChemical}: ${finalized.length} recommendation(s), ${newlyFlagged} force-flagged for unresolved guardrail issues`
  );

  return { skuRecommendations: finalized };
}
