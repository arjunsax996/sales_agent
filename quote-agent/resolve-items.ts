import { z } from "zod";
import { extractionModel } from "../agent/models";
import { chemicalIndex } from "../db/chemical-index";
import { log } from "../shared/log";
import type { QuoteRequestItem } from "./types";

/**
 * Resolve informal chemical language ("IPA", "caustic soda") against the
 * catalog — but never by handing the LLM the whole catalog. For each
 * requested item, chemicalIndex.search() retrieves only its top-k nearest
 * candidates by embedding similarity; the LLM then just picks (or rejects)
 * among those few candidates per item, in one call for the whole request.
 * This is what keeps quote resolution cheap and accurate regardless of
 * whether the catalog has 221 base chemicals or 100,000.
 */

const CANDIDATES_PER_ITEM = 8;

const resolutionSchema = z.object({
  matches: z.array(
    z.object({
      chemicalName: z.string(), // echoes the input so results line back up
      baseChemical: z.string().nullable(), // must be one of that item's own candidates, or null
      confidence: z.enum(["high", "medium", "low"]),
    })
  ),
});

export type ResolvedMatch = z.infer<typeof resolutionSchema>["matches"][number];
export type ResolveItemsFn = (items: QuoteRequestItem[]) => Promise<ResolvedMatch[]>;

export async function resolveItems(items: QuoteRequestItem[]): Promise<ResolvedMatch[]> {
  const itemsWithCandidates = await Promise.all(
    items.map(async (item) => ({
      chemicalName: item.chemicalName,
      candidates: (await chemicalIndex.search(item.chemicalName, CANDIDATES_PER_ITEM)).map((c) => c.baseChemical),
    }))
  );

  const structuredModel = extractionModel.withStructuredOutput(resolutionSchema);

  let result: z.infer<typeof resolutionSchema>;
  try {
    result = await structuredModel.invoke([
      {
        role: "system",
        content:
          "Each requested chemical name may be informal or abbreviated (e.g. 'IPA' for " +
          "Isopropyl Alcohol, 'caustic' for Sodium Hydroxide, 'bicarb' for Sodium " +
          "Bicarbonate). For each item, pick the best match from THAT ITEM'S OWN " +
          "candidates list only — never a candidate that belongs to a different item, " +
          "and never a name that isn't verbatim in its candidates list. If none of an " +
          "item's candidates are a plausible match, set baseChemical to null and " +
          "confidence to low rather than forcing a weak pick.",
      },
      {
        role: "user",
        content: JSON.stringify({ items: itemsWithCandidates }),
      },
    ]);
  } catch (err) {
    throw new Error(`resolveItems failed: ${(err as Error).message}`, { cause: err });
  }

  const byConfidence = { high: 0, medium: 0, low: 0 };
  for (const m of result.matches) byConfidence[m.confidence]++;
  log(
    "resolveItems",
    `${items.length} item(s): ${byConfidence.high} high, ${byConfidence.medium} medium, ${byConfidence.low} low confidence`
  );

  return result.matches;
}
