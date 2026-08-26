import { Annotation } from "@langchain/langgraph";
import type { FamilyStrategy, GuardrailIssue, NoteDirective, ProductRow, SkuRecommendation } from "./types";
import { overwriteNoDefault, overwriteWithDefault } from "./util";

export const RepricingState = Annotation.Root({
  baseChemical: Annotation<string>(overwriteNoDefault<string>()),
  products: Annotation<ProductRow[]>(overwriteNoDefault<ProductRow[]>()),

  // Set by triage, consumed by everything downstream.
  formulaicRecommendations: Annotation<SkuRecommendation[]>(overwriteWithDefault<SkuRecommendation[]>(() => [])),
  reasoningSkus: Annotation<ProductRow[]>(overwriteWithDefault<ProductRow[]>(() => [])),

  // Routed once, up front, for the whole catalog (agent/note-routing.ts) —
  // not computed inside this per-family graph. Supplied at invoke time.
  noteDirectives: Annotation<NoteDirective[]>(overwriteWithDefault<NoteDirective[]>(() => [])),
  familyStrategy: Annotation<FamilyStrategy | null>(overwriteWithDefault<FamilyStrategy | null>(() => null)),
  skuRecommendations: Annotation<SkuRecommendation[]>(overwriteWithDefault<SkuRecommendation[]>(() => [])),
  guardrailIssues: Annotation<GuardrailIssue[]>(overwriteWithDefault<GuardrailIssue[]>(() => [])),
  revisionCount: Annotation<number>(overwriteWithDefault<number>(() => 0)),
});

export type RepricingStateT = typeof RepricingState.State;
