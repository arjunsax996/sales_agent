import { z } from "zod";
import { reasoningModel } from "../models";
import type { RepricingStateT } from "../state";
import type { SkuRecommendation } from "../types";
import { log } from "../../shared/log";
import { withRetry } from "../../shared/retry";

/**
 * Apply the family strategy per SKU. Takes guardrail feedback on retry.
 * Only prices reasoningSkus.
 */

const skuRecommendationsSchema = z.object({
  recommendations: z.array(
    z.object({
      sku: z.string(),
      recommendedPrice: z.number(),
      marginPct: z.number(),
      rationale: z.string(),
      needsHumanReview: z.boolean(),
      // OpenAI's structured-output strict mode requires every property to be
      // in `required` — z.optional() omits it from `required` and 400s. Use
      // nullable() instead; downstream only ever checks truthiness, and
      // null is as falsy as undefined.
      reviewReason: z.string().nullable(),
    })
  ),
});

export async function priceSkus(state: RepricingStateT): Promise<Partial<RepricingStateT>> {
  const structuredModel = reasoningModel.withStructuredOutput(skuRecommendationsSchema);

  const feedbackBlock =
    state.guardrailIssues.length > 0
      ? `\n\nThe previous attempt had these issues — fix them:\n${state.guardrailIssues
          .map((i) => `- ${i.sku}: ${i.issue}${i.suggestedFix ? ` (try: ${i.suggestedFix})` : ""}`)
          .join("\n")}`
      : "";

  const startedAt = Date.now();
  let result: z.infer<typeof skuRecommendationsSchema>;
  try {
    result = await withRetry(
      () =>
        structuredModel.invoke([
          {
            role: "system",
            content: `Apply the family pricing strategy to each SKU individually, adjusting for that SKU's own cost, revenue, and win rate.
Flag needsHumanReview=true for: negative/near-zero margin, win rate under 20% (struggling to win deals) or over 80% (possibly underpriced), cost change over 25%, or any SKU the strategy doesn't cleanly cover.
Every recommendation needs a one-sentence rationale a sales rep could read out loud to a customer.${feedbackBlock}`,
          },
          {
            role: "user",
            content: JSON.stringify({ strategy: state.familyStrategy, skus: state.reasoningSkus }),
          },
        ]),
      { label: `priceSkus:${state.baseChemical}` }
    );
  } catch (err) {
    throw new Error(`priceSkus failed for family "${state.baseChemical}": ${(err as Error).message}`, { cause: err });
  }
  const elapsedMs = Date.now() - startedAt;

  // The model is only ever asked about state.reasoningSkus, but structured
  // output isn't a guarantee it covers exactly that set — it can drop a SKU
  // it forgot about, or hallucinate one that isn't in this family's batch.
  // Reconcile explicitly rather than trusting the response as-is.
  const expected = new Map(state.reasoningSkus.map((p) => [p.sku, p]));
  const recommendations: SkuRecommendation[] = [];
  const seen = new Set<string>();
  let hallucinated = 0;
  let duplicated = 0;

  for (const rec of result.recommendations) {
    if (!expected.has(rec.sku)) {
      hallucinated++; // hallucinated SKU outside this family's batch — drop it
      continue;
    }
    if (seen.has(rec.sku)) {
      duplicated++; // model returned this SKU more than once — keep the first, drop the rest
      continue;
    }
    seen.add(rec.sku);
    recommendations.push({ ...rec, reviewReason: rec.reviewReason ?? undefined });
  }

  let missing = 0;
  for (const [sku] of expected) {
    if (seen.has(sku)) continue;
    missing++;
    // Model silently omitted this SKU — don't let it vanish from the output.
    // Hold last year's price and force a human to look at it.
    recommendations.push({
      sku,
      recommendedPrice: expected.get(sku)!.lastYearPrice,
      marginPct: 0,
      rationale: "Model did not return a recommendation for this SKU — held last year's price pending review.",
      needsHumanReview: true,
      reviewReason: "Missing from the LLM pricing response.",
    });
  }

  log(
    "priceSkus",
    `${state.baseChemical} (attempt ${state.revisionCount + 1}): ${recommendations.length} priced in ${elapsedMs}ms` +
      (hallucinated > 0 ? `, ${hallucinated} hallucinated SKU(s) dropped` : "") +
      (duplicated > 0 ? `, ${duplicated} duplicate SKU(s) dropped` : "") +
      (missing > 0 ? `, ${missing} missing SKU(s) held at last year's price` : "")
  );

  return {
    skuRecommendations: recommendations,
    revisionCount: state.revisionCount + 1,
  };
}
