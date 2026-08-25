/**
 * One-time (or re-run-when-notes-change) batch job: runs the LangGraph
 * repricing pipeline (agent/) over data/products.csv + data/notes.csv and
 * upserts every SKU's recommendation into Postgres. The web app itself never
 * calls the LLM — it only reads/writes the review fields Prisma already has.
 * (The one exception: the "Batch Upload" tab in the app triggers this same
 * pipeline via lib/batchJob.ts, for updating the catalog without a terminal.)
 *
 * Usage: npm run seed  (needs OPENAI_API_KEY in .env; DATABASE_URL always required)
 */
import "dotenv/config";
import { loadNotes, loadProducts, repriceCatalog } from "../agent";
import { persistFamilyResult } from "../lib/persistFamily";
import { prisma } from "../lib/prisma";

const PRODUCTS_PATH = process.env.SEED_PRODUCTS_PATH ?? "data/products.csv";
const NOTES_PATH = process.env.SEED_NOTES_PATH ?? "data/notes.csv";

async function main() {
  const products = loadProducts(PRODUCTS_PATH);
  const notes = loadNotes(NOTES_PATH);
  const totalFamilies = new Set(products.map((p) => p.baseChemical)).size;

  console.log(`Repricing ${products.length} SKUs across ${totalFamilies} families...`);
  let familiesDone = 0;

  const results = await repriceCatalog(products, notes, async (result) => {
    await persistFamilyResult(result);
    familiesDone++;
    console.log(`  ${familiesDone}/${totalFamilies} families persisted (${result.baseChemical})`);
  });

  const failed = totalFamilies - results.length;
  console.log(`Done. ${results.length} families persisted, ${failed} failed (see errors above).`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
