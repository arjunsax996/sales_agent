/**
 * Ad-hoc runner for the quote agent. Needs Postgres already populated —
 * run `npm run seed` first.
 *
 * Usage:
 *   npm run quote -- --company "Acme Corp" --items quote-agent/example-request.json
 *   npm run quote -- --company "Acme Corp" --items <file.json> --out <quote.json>
 *
 * items file: a JSON array of { chemicalName, quantity, unit }.
 */

import "dotenv/config";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { chemicalIndex } from "../db/chemical-index";
import { prisma } from "../lib/prisma";
import { parseArgs } from "../shared/cli";
import { buildQuote } from "./build-quote";
import type { QuoteRequestItem } from "./types";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const companyName = String(args.company ?? "Unnamed Company");
  const itemsPath = resolve(String(args.items ?? "quote-agent/example-request.json"));

  const productCount = await prisma.product.count();
  if (productCount === 0) {
    console.error("Product table is empty — run `npm run seed` first to populate it.");
    process.exit(1);
  }

  // Cheap to call every time — only embeds base chemicals not already cached.
  const rows = await prisma.product.findMany({ distinct: ["baseChemical"], select: { baseChemical: true } });
  await chemicalIndex.sync(rows.map((r) => r.baseChemical));

  const items: QuoteRequestItem[] = JSON.parse(readFileSync(itemsPath, "utf-8"));
  const quote = await buildQuote({ companyName, items });

  console.log(JSON.stringify(quote, null, 2));
  console.log(
    `\n${quote.lineItems.length} items, subtotal $${quote.subtotal.toFixed(2)}, ` +
      `${quote.itemsNeedingReview} flagged for human review.`
  );

  if (args.out) {
    const outPath = resolve(String(args.out));
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(quote, null, 2));
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
