import { prisma } from "../lib/prisma";
import type { ResolvedMatch } from "./resolve-items";
import type { QuoteRequestItem } from "./types";

/**
 * Stand-in for resolveItems() when there's no LLM API key configured, so the
 * quote flow stays usable without one. No embeddings, no LLM call: just a
 * case-insensitive substring match against known base chemicals. Much weaker
 * than the real thing (won't catch "IPA" -> Isopropyl Alcohol), but exact or
 * near-exact names still resolve.
 */
export async function placeholderResolveItems(items: QuoteRequestItem[]): Promise<ResolvedMatch[]> {
  const rows = await prisma.product.findMany({ distinct: ["baseChemical"], select: { baseChemical: true } });
  const knownBaseChemicals = rows.map((r) => r.baseChemical);

  return items.map((item) => {
    const needle = item.chemicalName.trim().toLowerCase();
    const match = knownBaseChemicals.find(
      (name) => name.toLowerCase().includes(needle) || needle.includes(name.toLowerCase())
    );

    return {
      chemicalName: item.chemicalName,
      baseChemical: match ?? null,
      confidence: match ? "medium" : "low",
    };
  });
}
