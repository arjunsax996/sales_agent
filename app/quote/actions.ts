"use server";

import { chemicalIndex } from "@/db/chemical-index";
import { prisma } from "@/lib/prisma";
import { buildQuote, draftQuoteEmail, placeholderDraftEmail, placeholderResolveItems } from "@/quote-agent";
import type { QuoteEmail } from "@/quote-agent/draft-email";
import type { Quotation, QuoteRequestItem } from "@/quote-agent/types";

export async function generateQuote(companyName: string, items: QuoteRequestItem[]): Promise<Quotation & { mode: "llm" | "placeholder"; email: QuoteEmail }> {
  const trimmedCompany = companyName.trim();
  if (!trimmedCompany) throw new Error("Company name is required.");

  const validItems = items.filter((i) => i.chemicalName.trim() && i.quantity > 0 && i.unit.trim());
  if (validItems.length === 0) throw new Error("Add at least one item with a chemical name, a positive quantity, and a unit.");

  // Same reasoning as the batch pipeline: without a key, fall back to a
  // weaker substring match and a templated email instead of failing outright.
  if (!process.env.OPENAI_API_KEY?.trim()) {
    const quote = await buildQuote({ companyName: trimmedCompany, items: validItems }, placeholderResolveItems);
    return { ...quote, mode: "placeholder", email: placeholderDraftEmail(quote) };
  }

  // Cheap to call every time — only embeds base chemicals not already cached.
  const rows = await prisma.product.findMany({ distinct: ["baseChemical"], select: { baseChemical: true } });
  await chemicalIndex.sync(rows.map((r) => r.baseChemical));

  const quote = await buildQuote({ companyName: trimmedCompany, items: validItems });
  const email = await draftQuoteEmail(quote);
  return { ...quote, mode: "llm", email };
}
