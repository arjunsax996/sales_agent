import { repricingApp } from "./graph";
import type { ProductRow } from "./types";
import { log } from "../shared/log";

export async function repriceFamily(baseChemical: string, products: ProductRow[], rawNotes: string[]) {
  log("repriceFamily", `${baseChemical}: starting (${products.length} SKUs)`);
  const startedAt = Date.now();
  const result = await repricingApp.invoke({
    baseChemical,
    products,
    rawNotes,
    formulaicRecommendations: [],
    reasoningSkus: [],
    noteDirectives: [],
    familyStrategy: null,
    skuRecommendations: [],
    guardrailIssues: [],
    revisionCount: 0,
  });
  log("repriceFamily", `${baseChemical}: finished in ${Date.now() - startedAt}ms`);
  return result;
}

/**
 * Top-level catalog run: group ~1,100 SKUs into families, run the graph per
 * family with limited concurrency, persist results as they land.
 * TODO: swap the sequential chunking below for an Inngest fan-out
 * (one event per family) so a catalog run isn't limited by one process.
 */
export async function repriceCatalog(
  allProducts: ProductRow[],
  allNotes: string[],
  onFamilyComplete?: (result: Awaited<ReturnType<typeof repriceFamily>>) => void | Promise<void>
) {
  const families = new Map<string, ProductRow[]>();
  for (const p of allProducts) {
    if (!families.has(p.baseChemical)) families.set(p.baseChemical, []);
    families.get(p.baseChemical)!.push(p);
  }

  const CONCURRENCY = 5;
  const entries = [...families.entries()];
  const results: Awaited<ReturnType<typeof repriceFamily>>[] = [];

  log("repriceCatalog", `${entries.length} families, concurrency ${CONCURRENCY}`);

  for (let i = 0; i < entries.length; i += CONCURRENCY) {
    const batch = entries.slice(i, i + CONCURRENCY);
    log("repriceCatalog", `batch ${i / CONCURRENCY + 1}: ${batch.map(([name]) => name).join(", ")}`);
    const batchSettled = await Promise.allSettled(
      batch.map(([baseChemical, products]) => repriceFamily(baseChemical, products, allNotes))
    );

    for (let j = 0; j < batchSettled.length; j++) {
      const settled = batchSettled[j];
      if (settled.status === "fulfilled") {
        results.push(settled.value);
        // Persist as each family lands (rather than after the whole catalog
        // finishes) so a crash mid-run doesn't lose already-completed families.
        await onFamilyComplete?.(settled.value);
      } else {
        // One family's failure (bad data, transient LLM error) shouldn't take
        // down the rest of the batch's already-completed results with it.
        console.error(`repriceCatalog: family "${batch[j][0]}" failed`, settled.reason);
      }
    }
  }

  return results;
}
