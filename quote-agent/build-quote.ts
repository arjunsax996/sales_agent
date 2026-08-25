import { prisma } from "../lib/prisma";
import { log } from "../shared/log";
import { GRADE_RANK, round2 } from "../shared/util";
import { resolveItems, type ResolveItemsFn } from "./resolve-items";
import type { QuoteLineItem, QuoteRequest, Quotation } from "./types";
import { parsePackSize, toCanonical, unitFamily } from "./unit-utils";

// Default grade preference when the requester doesn't name one — cheapest/
// most common commodity grade first. Anything not in GRADE_RANK (including
// products with no grade variants at all) sorts last.
function gradeSortKey(grade: string): number {
  return grade in GRADE_RANK ? GRADE_RANK[grade] : Number.MAX_SAFE_INTEGER;
}

export async function buildQuote(request: QuoteRequest, resolve: ResolveItemsFn = resolveItems): Promise<Quotation> {
  const matches = await resolve(request.items);
  const matchByName = new Map(matches.map((m) => [m.chemicalName, m]));

  // One query for every base chemical any item matched to, rather than a
  // round-trip per item — the per-item logic below stays synchronous.
  const matchedBaseChemicals = [
    ...new Set(matches.map((m) => (m.confidence !== "low" ? m.baseChemical : null)).filter((b): b is string => b !== null)),
  ];
  const rows = matchedBaseChemicals.length > 0 ? await prisma.product.findMany({ where: { baseChemical: { in: matchedBaseChemicals } } }) : [];
  const variantsByBaseChemical = new Map<string, typeof rows>();
  for (const row of rows) {
    if (!variantsByBaseChemical.has(row.baseChemical)) variantsByBaseChemical.set(row.baseChemical, []);
    variantsByBaseChemical.get(row.baseChemical)!.push(row);
  }

  const lineItems: QuoteLineItem[] = request.items.map((requested) => {
    const match = matchByName.get(requested.chemicalName);
    const baseChemical = match?.confidence !== "low" ? match?.baseChemical ?? null : null;

    if (!baseChemical) {
      return unresolved(requested, `Couldn't confidently match "${requested.chemicalName}" to a catalog product.`);
    }

    const variants = variantsByBaseChemical.get(baseChemical) ?? [];
    if (variants.length === 0) {
      // The model named a base chemical that isn't actually in the catalog —
      // don't trust it silently, flag it same as an unresolved match.
      return unresolved(requested, `Matched to "${baseChemical}", but no such product family exists in the catalog.`, baseChemical);
    }

    const requestedFamily = unitFamily(requested.unit);
    const requestedCanonicalQty = requestedFamily ? toCanonical(requested.quantity, requested.unit) : null;

    const withPackSize = variants
      .map((variant) => ({ variant, packSize: parsePackSize(variant.packSize) }))
      .filter((v): v is { variant: (typeof variants)[number]; packSize: { quantity: number; unit: string } } =>
        v.packSize !== null
      );

    const compatible = withPackSize.filter((v) => unitFamily(v.packSize.unit) === requestedFamily);

    if (!requestedFamily || requestedCanonicalQty === null || compatible.length === 0) {
      return unresolved(
        requested,
        `Matched "${baseChemical}", but couldn't reconcile the unit "${requested.unit}" with any pack size on file for it.`,
        baseChemical
      );
    }

    // Prefer the house default grade order; within the preferred grade, pick
    // the largest pack size at or under the requested quantity (fewer units
    // to fulfill the order), falling back to the smallest pack size if the
    // request is smaller than everything available.
    const preferredGrade = [...compatible].sort((a, b) => gradeSortKey(a.variant.grade) - gradeSortKey(b.variant.grade))[0]
      .variant.grade;
    const sameGrade = compatible.filter((v) => v.variant.grade === preferredGrade);

    const withCanonicalPack = sameGrade.map((v) => ({
      ...v,
      canonicalPackQty: toCanonical(v.packSize.quantity, v.packSize.unit)!,
    }));

    const atOrUnder = withCanonicalPack.filter((v) => v.canonicalPackQty <= requestedCanonicalQty);
    const chosen =
      atOrUnder.length > 0
        ? atOrUnder.reduce((biggest, v) => (v.canonicalPackQty > biggest.canonicalPackQty ? v : biggest))
        : withCanonicalPack.reduce((smallest, v) => (v.canonicalPackQty < smallest.canonicalPackQty ? v : smallest));

    const unitsNeeded = Math.ceil(requestedCanonicalQty / chosen.canonicalPackQty);
    const lineTotal = round2(chosen.variant.recommendedPrice * unitsNeeded);

    return {
      requested,
      matchedBaseChemical: baseChemical,
      matchedSku: chosen.variant.sku,
      matchedProductLabel: `${baseChemical}${chosen.variant.grade ? `, ${chosen.variant.grade} Grade` : ""}, ${chosen.variant.packSize}`,
      unitPrice: chosen.variant.recommendedPrice,
      unitsNeeded,
      lineTotal,
      needsHumanReview: chosen.variant.needsHumanReview,
      reviewReason: chosen.variant.needsHumanReview
        ? `Underlying price for ${chosen.variant.sku} is itself flagged: ${chosen.variant.reviewReason ?? "needs review"}`
        : undefined,
    };
  });

  const subtotal = round2(lineItems.reduce((sum, li) => sum + (li.lineTotal ?? 0), 0));
  const itemsNeedingReview = lineItems.filter((li) => li.needsHumanReview).length;

  log(
    "buildQuote",
    `${request.companyName}: ${lineItems.length} line item(s), ${itemsNeedingReview} flagged for review, subtotal $${subtotal.toFixed(2)}`
  );

  return {
    companyName: request.companyName,
    generatedAt: new Date().toISOString(),
    lineItems,
    subtotal,
    itemsNeedingReview,
  };
}

function unresolved(requested: QuoteLineItem["requested"], reviewReason: string, matchedBaseChemical: string | null = null): QuoteLineItem {
  return {
    requested,
    matchedBaseChemical,
    matchedSku: null,
    matchedProductLabel: null,
    unitPrice: null,
    unitsNeeded: null,
    lineTotal: null,
    needsHumanReview: true,
    reviewReason,
  };
}
