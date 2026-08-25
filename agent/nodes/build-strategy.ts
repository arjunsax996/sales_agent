import { z } from "zod";
import { reasoningModel } from "../models";
import type { RepricingStateT } from "../state";
import { log } from "../../shared/log";
import { pctChange, round2 } from "../../shared/util";

/**
 * Set a family-level pricing strategy from cost trend, aggregate
 * revenue/win-rate, and the note directives. Only sees reasoningSkus — the
 * no-history SKUs were already priced in triage.
 */

const familyStrategySchema = z.object({
  targetMarginDeltaPct: z.number(),
  rationale: z.string(),
  citedNotes: z.array(z.string()),
});

export async function buildStrategy(state: RepricingStateT): Promise<Partial<RepricingStateT>> {
  const structuredModel = reasoningModel.withStructuredOutput(familyStrategySchema);

  const aggregate = state.reasoningSkus.map((p) => {
    const costChangePct = pctChange(p.lastYearCost, p.newCost);
    return {
      sku: p.sku,
      grade: p.grade,
      packSize: p.packSize,
      costChangePct: round2(costChangePct),
      lastYearRevenue: p.lastYearRevenue,
      winRate: p.winRate,
      // Flag the danger zone found in the catalog: rising cost + already losing quotes.
      doubleRisk: costChangePct > 15 && (p.winRate ?? 1) < 0.4,
    };
  });

  let result: z.infer<typeof familyStrategySchema>;
  try {
    result = await structuredModel.invoke([
      {
        role: "system",
        content: `You are a pricing strategist for a chemical distributor.
Given cost trends, historical revenue/win-rate, and sales-note directives for one product family, set a single target margin-delta (percentage points vs. last year) for the whole family.
High win rate + rising cost pressure = room to push margin up. Low win rate, "doubleRisk" SKUs, or explicit customer pushback in notes = hold or reduce margin.
Be conservative on contradictory signals, and weigh leadership-level directives (GM/VP notes) over a single rep's opinion.`,
      },
      {
        role: "user",
        content: JSON.stringify({ baseChemical: state.baseChemical, skus: aggregate, noteDirectives: state.noteDirectives }),
      },
    ]);
  } catch (err) {
    throw new Error(`buildStrategy failed for family "${state.baseChemical}": ${(err as Error).message}`, { cause: err });
  }

  log(
    "buildStrategy",
    `${state.baseChemical}: target margin ${result.targetMarginDeltaPct >= 0 ? "+" : ""}${result.targetMarginDeltaPct}pt vs. last year`
  );

  return { familyStrategy: result };
}
