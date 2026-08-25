import { Annotation } from "@langchain/langgraph";
import type { FamilyStrategy, GuardrailIssue, NoteDirective, ProductRow, SkuRecommendation } from "./types";
import { overwriteNoDefault, overwriteWithDefault } from "./util";

export const RepricingState = Annotation.Root({
  baseChemical: Annotation<string>(overwriteNoDefault<string>()),
  products: Annotation<ProductRow[]>(overwriteNoDefault<ProductRow[]>()),
  rawNotes: Annotation<string[]>(overwriteNoDefault<string[]>()),

  // Set by triage, consumed by everything downstream.
  formulaicRecommendations: Annotation<SkuRecommendation[]>(overwriteWithDefault<SkuRecommendation[]>(() => [])),
  reasoningSkus: Annotation<ProductRow[]>(overwriteWithDefault<ProductRow[]>(() => [])),

  noteDirectives: Annotation<NoteDirective[]>(overwriteWithDefault<NoteDirective[]>(() => [])),
  familyStrategy: Annotation<FamilyStrategy | null>(overwriteWithDefault<FamilyStrategy | null>(() => null)),
  skuRecommendations: Annotation<SkuRecommendation[]>(overwriteWithDefault<SkuRecommendation[]>(() => [])),
  guardrailIssues: Annotation<GuardrailIssue[]>(overwriteWithDefault<GuardrailIssue[]>(() => [])),
  revisionCount: Annotation<number>(overwriteWithDefault<number>(() => 0)),
});

export type RepricingStateT = typeof RepricingState.State;
