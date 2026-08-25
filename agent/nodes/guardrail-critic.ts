import type { RepricingStateT } from "../state";
import type { GuardrailIssue } from "../types";
import { log } from "../../shared/log";
import { GRADE_RANK, marginPct, pctChange } from "../../shared/util";

/**
 * Deterministic guardrail checks — no LLM call needed for most of this, keep
 * it cheap and reliable. Escalate to human review rather than silently
 * "fixing" pricing. Checks against the FULL family (state.products),
 * including formulaic SKUs, so cross-grade checks see the whole picture.
 */
export function guardrailCritic(state: RepricingStateT): Partial<RepricingStateT> {
  const issues: GuardrailIssue[] = [];
  const bySku = new Map(state.products.map((p) => [p.sku, p]));
  // Validate every recommendation this family produced — formulaic prices are
  // just as capable of breaching the margin floor, swing cap, or grade
  // ordering as LLM-priced ones, and previously only the latter were checked.
  const allRecs = [...state.formulaicRecommendations, ...state.skuRecommendations];

  for (const rec of allRecs) {
    const product = bySku.get(rec.sku);
    if (!product) continue;

    const margin = marginPct(rec.recommendedPrice, product.newCost);
    if (margin < 5) {
      issues.push({ sku: rec.sku, issue: `Margin ${margin.toFixed(1)}% is below the 5% floor` });
    }

    const priceDeltaPct = pctChange(product.lastYearPrice, rec.recommendedPrice);
    if (Math.abs(priceDeltaPct) > 30) {
      issues.push({ sku: rec.sku, issue: `Price change of ${priceDeltaPct.toFixed(1)}% exceeds the 30% swing cap` });
    }

    // Cross-SKU: higher grade of the same chemical/pack size shouldn't be cheaper.
    // We saw this bug already exist in last year's data (e.g. Sodium Bicarbonate
    // USP/NF priced above ACS Reagent) so check against every sibling, not just
    // the ones that went through the LLM this run.
    for (const other of allRecs) {
      if (other.sku === rec.sku) continue;
      const otherProduct = bySku.get(other.sku);
      if (!otherProduct || otherProduct.packSize !== product.packSize) continue;

      // A blank grade means the catalog just never stated one for this SKU —
      // that's normal (about half the catalog), not an anomaly, and there's
      // nothing to compare against another grade. Don't flag it.
      if (product.grade === "" || otherProduct.grade === "") continue;

      const productRank = GRADE_RANK[product.grade];
      const otherRank = GRADE_RANK[otherProduct.grade];
      if (productRank === undefined || otherRank === undefined) {
        // A *non-empty* grade string that isn't in the map is a real anomaly
        // (typo, new grade never seen before) — unlike a blank grade, this is
        // exactly how a real ordering bug would go unnoticed if skipped silently.
        issues.push({
          sku: rec.sku,
          issue: `Grade "${productRank === undefined ? product.grade : otherProduct.grade}" isn't in GRADE_RANK — can't verify ordering against ${other.sku}`,
        });
        continue;
      }

      if (productRank < otherRank && rec.recommendedPrice > other.recommendedPrice) {
        issues.push({
          sku: rec.sku,
          issue: `${product.grade} priced above ${otherProduct.grade} (${other.sku}) at the same pack size`,
          suggestedFix: `Keep below ${other.recommendedPrice}`,
        });
      }
    }
  }

  log("guardrailCritic", `${state.baseChemical}: ${issues.length} issue(s) found`);

  return { guardrailIssues: issues };
}

export function routeAfterGuardrail(state: RepricingStateT): "retry" | "done" {
  // Retrying only makes sense when there's an LLM-priced batch to re-price —
  // a formulaic-only family (skip path) has no reasoningSkus/familyStrategy
  // for priceSkus to act on, so looping back would just spin uselessly.
  const canRetryWithLLM = state.reasoningSkus.length > 0 && state.revisionCount < 2;
  const decision = state.guardrailIssues.length > 0 && canRetryWithLLM ? "retry" : "done";
  log(
    "guardrailCritic",
    `${state.baseChemical}: routing to "${decision}"${decision === "retry" ? ` (revision ${state.revisionCount + 1})` : ""}`
  );
  return decision;
}
