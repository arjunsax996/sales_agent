import { repricingApp } from "./graph";
import { routeNotesToFamilies } from "./note-routing";
import { familyNeedsReasoning } from "./nodes/triage";
import type { NoteDirective, ProductRow } from "./types";
import { log } from "../shared/log";

export async function repriceFamily(baseChemical: string, products: ProductRow[], noteDirectives: NoteDirective[]) {
  log("repriceFamily", `${baseChemical}: starting (${products.length} SKUs)`);
  const startedAt = Date.now();
  const result = await repricingApp.invoke({
    baseChemical,
    products,
    formulaicRecommendations: [],
    reasoningSkus: [],
    noteDirectives,
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
 * TODO: swap the worker pool below for an Inngest fan-out (one event per
 * family) so a catalog run isn't limited by one process.
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

  // Raised from 5 now that withRetry backs every LLM call — a transient
  // 429/5xx no longer drops the whole family, so more concurrent requests
  // means more throughput instead of just more dropped families. Tune down
  // if your OpenAI tier's rate limits start rejecting requests outright.
  const CONCURRENCY = 15;
  const entries = [...families.entries()];
  const results: Awaited<ReturnType<typeof repriceFamily>>[] = [];
  const startedAt = Date.now();

  log("repriceCatalog", `${entries.length} families, concurrency ${CONCURRENCY}`);

  // Route notes once for the whole catalog, up front — not per family (see
  // agent/note-routing.ts) — and skip it entirely for formulaic-only
  // families, which never reach buildStrategy and so never read noteDirectives.
  // Deliberately NOT awaited here: kicking it off and letting the worker
  // pool start immediately means formulaic-only families (most of the
  // catalog) aren't stalled waiting on notes they'll never read. Each
  // worker only awaits this shared promise when it actually lands on a
  // family that needs it — by then it's likely already resolved, having
  // run concurrently with everything else since the pool started.
  const reasoningFamilyNames = entries.filter(([, products]) => familyNeedsReasoning(products)).map(([name]) => name);
  const notesByFamilyPromise = routeNotesToFamilies(reasoningFamilyNames, allNotes);

  // A worker pool, not fixed-size batches: each worker grabs the next family
  // off the queue the moment it's free, so a slow family (extra guardrail
  // retries, a slow LLM response) no longer stalls the other CONCURRENCY-1
  // slots waiting for its batch to fully drain before starting the next one.
  let nextIndex = 0;
  async function worker() {
    for (;;) {
      const index = nextIndex++;
      if (index >= entries.length) return;
      const [baseChemical, products] = entries[index];
      try {
        const noteDirectives = familyNeedsReasoning(products) ? (await notesByFamilyPromise).get(baseChemical) ?? [] : [];
        const result = await repriceFamily(baseChemical, products, noteDirectives);
        results.push(result);
        // Persist as each family lands (rather than after the whole catalog
        // finishes) so a crash mid-run doesn't lose already-completed families.
        await onFamilyComplete?.(result);
      } catch (err) {
        // One family's failure (bad data, LLM error withRetry couldn't
        // recover from) shouldn't take down the rest of the run with it.
        console.error(`repriceCatalog: family "${baseChemical}" failed`, err);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, entries.length) }, worker));

  const elapsedMs = Date.now() - startedAt;
  log(
    "repriceCatalog",
    `done: ${results.length}/${entries.length} families in ${elapsedMs}ms ` +
      `(${(elapsedMs / entries.length).toFixed(0)}ms/family avg, ${((entries.length / elapsedMs) * 1000).toFixed(2)} families/sec)`
  );

  return results;
}
