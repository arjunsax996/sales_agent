// Domain types — line these up with the Prisma schema once that exists.

export interface ProductRow {
  sku: string;
  baseChemical: string;
  category: string;
  packSize: string; // "500 mL" | "5 Gal" | "55 Gal Drum" ...
  grade: string; // "Technical" | "Industrial" | "ACS Reagent" ...
  lastYearCost: number;
  lastYearPrice: number;
  newCost: number;
  lastYearRevenue: number; // dollars sold last year, NOT unit count — 0 means no sales history
  winRate: number | null; // 0-1, null when lastYearRevenue is 0 (no quotes to measure)
}

export interface NoteDirective {
  summary: string;
  sentiment: "pressure_down" | "pressure_up" | "risk" | "neutral";
  sourceNoteExcerpt: string;
}

export interface FamilyStrategy {
  targetMarginDeltaPct: number; // e.g. +2 means push margin up 2pts vs last year
  rationale: string;
  citedNotes: string[];
}

export interface SkuRecommendation {
  sku: string;
  recommendedPrice: number;
  marginPct: number;
  rationale: string;
  needsHumanReview: boolean;
  reviewReason?: string;
}

export interface GuardrailIssue {
  sku: string;
  issue: string;
  suggestedFix?: string;
}
