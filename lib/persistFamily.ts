import type { repriceFamily } from "../agent/run";
import { pctChange, round2 } from "../shared/util";
import { prisma } from "./prisma";

/**
 * Maps one family's graph result to Prisma upserts and writes it. Shared by
 * scripts/seed.ts (CLI) and lib/batchJob.ts (triggered from the web app) so
 * the two entry points can't drift on how a recommendation becomes a row.
 */
export async function persistFamilyResult(result: Awaited<ReturnType<typeof repriceFamily>>) {
  const byProduct = new Map(result.products.map((p) => [p.sku, p]));
  const merged = [...result.formulaicRecommendations, ...result.skuRecommendations];

  await prisma.$transaction(
    merged.map((rec) => {
      const product = byProduct.get(rec.sku);
      if (!product) throw new Error(`persistFamilyResult: recommendation for unknown sku ${rec.sku}`);

      // Dollar impact of the recommended change vs. last year — 0 for SKUs
      // with no sales history, since there's nothing to weigh the change against.
      const revenueImpact =
        product.lastYearRevenue > 0 ? round2(Math.abs((product.lastYearRevenue * pctChange(product.lastYearPrice, rec.recommendedPrice)) / 100)) : 0;

      const data = {
        sku: product.sku,
        baseChemical: result.baseChemical,
        grade: product.grade,
        packSize: product.packSize,
        category: product.category,
        lastYearCost: product.lastYearCost,
        lastYearPrice: product.lastYearPrice,
        newCost: product.newCost,
        lastYearRevenue: product.lastYearRevenue,
        winRate: product.winRate,
        recommendedPrice: rec.recommendedPrice,
        marginPct: rec.marginPct,
        rationale: rec.rationale,
        needsHumanReview: rec.needsHumanReview,
        reviewReason: rec.reviewReason,
        familyRationale: result.familyStrategy?.rationale,
        familyTargetMarginDeltaPct: result.familyStrategy?.targetMarginDeltaPct,
        familyCitedNotes: result.familyStrategy?.citedNotes ?? [],
        revenueImpact,
      };

      return prisma.product.upsert({ where: { sku: product.sku }, create: data, update: data });
    })
  );
}
