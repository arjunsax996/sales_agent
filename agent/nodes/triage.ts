import type { RepricingStateT } from "../state";
import type { SkuRecommendation } from "../types";
import { log } from "../../shared/log";
import { round2 } from "../../shared/util";

/**
 * Triage / routing — pure code, no LLM. This is where the catalog patterns
 * we found in products.csv turn into actual routing decisions:
 *   - no sales history (winRate === null)     -> formulaic, skip the LLM
 *   - cost alone wipes out last year's price   -> formulaic price, but
 *                                                 force human review
 *   - has real sales history                   -> goes to the reasoning path
 */
export function triage(state: RepricingStateT): Partial<RepricingStateT> {
  const formulaic: SkuRecommendation[] = [];
  const reasoning: RepricingStateT["products"] = [];

  for (const p of state.products) {
    const hasHistory = p.winRate !== null;

    if (hasHistory) {
      // Real sales data exists — let the reasoning path decide, even if there's
      // also a margin breach, since notes/win-rate context might change the call.
      reasoning.push(p);
      continue;
    }

    const lastYearMarginPct = (p.lastYearPrice - p.lastYearCost) / p.lastYearPrice;
    const holdMarginPrice = p.newCost / (1 - lastYearMarginPct);
    // A zero/missing last-year price (or a 100%-margin edge case) makes "hold
    // last year's margin % flat" meaningless — it produces NaN/Infinity, not
    // a price. Fall back to a zero-markup, cost-based price and force a human
    // to set the real number instead of shipping a broken value.
    const hasUsableHistory = p.lastYearPrice > 0 && Number.isFinite(holdMarginPrice) && holdMarginPrice > 0;
    const formulaicPrice = hasUsableHistory ? holdMarginPrice : p.newCost;
    // Cost alone has eaten the entire old price — no formula can fix this quietly.
    const marginBreach = p.newCost >= p.lastYearPrice;
    const needsHumanReview = marginBreach || !hasUsableHistory;

    formulaic.push({
      sku: p.sku,
      recommendedPrice: round2(formulaicPrice),
      marginPct: hasUsableHistory ? round2(lastYearMarginPct * 100) : 0,
      rationale: !hasUsableHistory
        ? "No usable last-year price on record — passed this year's cost through with no markup; needs review."
        : marginBreach
          ? "No sales history to reason from, and this year's cost alone exceeds last year's price."
          : "No sales history last year — held last year's margin % flat against this year's cost.",
      needsHumanReview,
      reviewReason: !hasUsableHistory
        ? "Last-year price was 0/missing or produced an invalid margin calc — formulaic hold-margin isn't meaningful."
        : marginBreach
          ? "Cost increase wipes out margin at last year's price; no sales history to judge demand impact."
          : undefined,
    });
  }

  log("triage", `${state.baseChemical}: ${formulaic.length} formulaic, ${reasoning.length} to reasoning path`);

  return { formulaicRecommendations: formulaic, reasoningSkus: reasoning };
}

export function routeAfterTriage(state: RepricingStateT): "reason" | "skip" {
  return state.reasoningSkus.length > 0 ? "reason" : "skip";
}
