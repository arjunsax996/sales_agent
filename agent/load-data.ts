import { readFileSync } from "fs";
import { parseCsv } from "../shared/csv";
import type { ProductRow } from "./types";

// product_name looks like "Formic Acid (88%), ACS Reagent Grade, 1 Gal" —
// pull the grade and pack size out, whatever's left is the base chemical
// that ties sibling SKUs (different pack size/grade) into one family.
const GRADE_WORDS = ["ACS Reagent Grade", "Industrial Grade", "Technical Grade", "USP/NF Grade"];
const PACK_SIZE_RE = /^\d+(\.\d+)?\s*(mL|L|Gal|kg|g|lb)\b|Drum|Bag|Pail|Tote/i;

export function parseProductName(name: string): { baseChemical: string; grade: string; packSize: string } {
  const parts = name.split(",").map((p) => p.trim());
  let grade = ""; // left blank (not guessed) when the name has no grade word
  let packSize = "";
  const kept: string[] = [];

  for (const part of parts) {
    const gradeWord = GRADE_WORDS.find((g) => part === g);
    if (gradeWord) {
      grade = gradeWord.replace(" Grade", "");
      continue;
    }
    if (PACK_SIZE_RE.test(part)) {
      packSize = part;
      continue;
    }
    kept.push(part);
  }

  return { baseChemical: kept.join(", "), grade, packSize };
}

// Text-in versions, for callers that already have the CSV in memory (e.g. a
// server handling an upload) and shouldn't have to round-trip through a file.
export function parseProductsCsv(text: string): ProductRow[] {
  return parseCsv(text).records.map((row) => {
    const { baseChemical, grade, packSize } = parseProductName(row.product_name);
    return {
      sku: row.sku,
      baseChemical,
      category: row.category,
      packSize,
      grade,
      lastYearCost: Number(row.prev_year_cost),
      lastYearPrice: Number(row.prev_year_price),
      newCost: Number(row.new_cost),
      lastYearRevenue: Number(row.prev_year_sales),
      winRate: row.win_rate === "" ? null : Number(row.win_rate),
    };
  });
}

export function parseNotesCsv(text: string): string[] {
  return parseCsv(text).records.map((row) => row.note);
}

export function loadProducts(path: string): ProductRow[] {
  return parseProductsCsv(readFileSync(path, "utf-8"));
}

export function loadNotes(path: string): string[] {
  return parseNotesCsv(readFileSync(path, "utf-8"));
}
