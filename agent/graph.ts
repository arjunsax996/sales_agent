/**
 * Pipeline (per product family, i.e. per base chemical):
 *
 *   START -> triage -+-> (no SKUs need reasoning) ------------------+
 *                     |                                             |
 *                     +-> (some SKUs need reasoning) -> extractNotes |
 *                                                           |        |
 *                                                           v        |
 *                                                     buildStrategy  |
 *                                                           |        |
 *                                                           v        |
 *                                                       priceSkus    |
 *                                                           |        |
 *                                                           v        v
 *                                                     guardrailCritic -(retry, LLM path only)-> priceSkus
 *                                                                          |
 *                                                                       (done)
 *                                                                          v
 *                                                                       finalize -> END
 *
 * Triage is the routing step: ~57% of SKUs have no prior-year sales, so there's
 * no volume/win-rate signal to reason about. Those get a deterministic
 * cost-pass-through price with no LLM call. Only SKUs with real sales history
 * go through note extraction + family strategy + per-SKU pricing. If an entire
 * family has zero sales history, the whole family skips the LLM path — but
 * still runs through guardrailCritic, since a formulaic price can violate the
 * margin floor, swing cap, or cross-grade ordering checks just as easily as an
 * LLM-priced one. (There's nothing to retry there — no LLM output to fix — so
 * routeAfterGuardrail never loops formulaic-only issues back to priceSkus; it
 * just flags them for finalize to mark needsHumanReview.)
 *
 * Run once per base-chemical family (~150-250 families) rather than per SKU (~1,100)
 * so the LLM reasons about "Isopropyl Alcohol" once, then applies that strategy
 * across its 500mL / 5 Gal / 55 Gal Drum x Technical / Industrial / ACS variants.
 */

import { END, START, StateGraph } from "@langchain/langgraph";
import { buildStrategy } from "./nodes/build-strategy";
import { extractNotes } from "./nodes/extract-notes";
import { finalize } from "./nodes/finalize";
import { guardrailCritic, routeAfterGuardrail } from "./nodes/guardrail-critic";
import { priceSkus } from "./nodes/price-skus";
import { routeAfterTriage, triage } from "./nodes/triage";
import { RepricingState } from "./state";

const graph = new StateGraph(RepricingState)
  .addNode("triage", triage)
  .addNode("extractNotes", extractNotes)
  .addNode("buildStrategy", buildStrategy)
  .addNode("priceSkus", priceSkus)
  .addNode("guardrailCritic", guardrailCritic)
  .addNode("finalize", finalize)
  .addEdge(START, "triage")
  .addConditionalEdges("triage", routeAfterTriage, {
    reason: "extractNotes",
    skip: "guardrailCritic",
  })
  .addEdge("extractNotes", "buildStrategy")
  .addEdge("buildStrategy", "priceSkus")
  .addEdge("priceSkus", "guardrailCritic")
  .addConditionalEdges("guardrailCritic", routeAfterGuardrail, {
    retry: "priceSkus",
    done: "finalize",
  })
  .addEdge("finalize", END);

export const repricingApp = graph.compile();
