import { z } from "zod";
import { extractionModel } from "../agent/models";
import { log } from "../shared/log";
import type { Quotation } from "./types";

/**
 * Turns the already-computed Quotation (pricing/matching logic is untouched,
 * this only writes prose around it) into a customer-facing email. Uses the
 * cheap/fast model, same as extractNotes — this is formatting, not reasoning
 * about a price.
 */

const emailSchema = z.object({
  subject: z.string(),
  body: z.string(),
});

export interface QuoteEmail {
  subject: string;
  body: string;
}

export async function draftQuoteEmail(quote: Quotation): Promise<QuoteEmail> {
  const structuredModel = extractionModel.withStructuredOutput(emailSchema);

  let result: QuoteEmail;
  try {
    result = await structuredModel.invoke([
      {
        role: "system",
        content: `You are a sales rep at a chemical distributor, writing a quote email to a customer.
Write a warm, professional, concise email presenting the quote data you're given as JSON.
Mention each matched item with its quantity and price. If an item couldn't be matched to a
product or needs internal review, mention briefly and neutrally that you'll follow up on it
by name — never expose internal review reasons, margin/rationale, or SKU codes to the customer.
Close with the subtotal and a clear call to action (reply to confirm, or ask questions).
Plain email prose, no markdown formatting. Sign off as "The Sales Team".`,
      },
      { role: "user", content: JSON.stringify(quote) },
    ]);
  } catch (err) {
    throw new Error(`draftQuoteEmail failed: ${(err as Error).message}`, { cause: err });
  }

  log("draftQuoteEmail", `${quote.companyName}: drafted (subject: "${result.subject}")`);

  return result;
}

// No-LLM-key fallback — same reasoning as quote-agent/placeholder-resolve.ts.
export function placeholderDraftEmail(quote: Quotation): QuoteEmail {
  const lines = quote.lineItems.map((li) => {
    if (li.matchedProductLabel && li.unitPrice != null && li.lineTotal != null) {
      return `  - ${li.matchedProductLabel} — ${li.unitsNeeded} unit(s) @ $${li.unitPrice.toFixed(2)} = $${li.lineTotal.toFixed(2)}`;
    }
    return `  - ${li.requested.chemicalName} (${li.requested.quantity} ${li.requested.unit}) — we'll follow up with pricing on this item`;
  });

  const body = `Hi ${quote.companyName} team,

Thank you for reaching out. Here's the quote you requested:

${lines.join("\n")}

Subtotal: $${quote.subtotal.toFixed(2)}

Let us know if you'd like to proceed or have any questions.

Best regards,
The Sales Team`;

  return { subject: `Your quote from us — ${quote.companyName}`, body };
}
