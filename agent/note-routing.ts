import { z } from "zod";
import { extractionModel } from "./models";
import type { NoteDirective } from "./types";
import { log } from "../shared/log";
import { withRetry } from "../shared/retry";

/**
 * One-time, chunked pass that routes the raw CRM note dump to every family
 * that needs it — replaces what used to be a separate "extractNotes" LLM
 * call inside each family's graph run. Every reasoning-path family was
 * independently asking the model "which of these same ~130 notes apply to
 * you?" against an identical notes corpus: redundant work, and a whole
 * extra sequential LLM round-trip on every family's critical path. Chunking
 * families into groups and routing each chunk in one call removes that
 * stage from repriceFamily entirely and cuts total call volume roughly
 * CHUNK_SIZE-fold.
 */

const CHUNK_SIZE = 20;

const chunkRoutingSchema = z.object({
  families: z.array(
    z.object({
      baseChemical: z.string(),
      directives: z.array(
        z.object({
          summary: z.string(),
          sentiment: z.enum(["pressure_down", "pressure_up", "risk", "neutral"]),
          sourceNoteExcerpt: z.string(),
        })
      ),
    })
  ),
});

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

async function routeChunk(baseChemicals: string[], rawNotes: string[]): Promise<Map<string, NoteDirective[]>> {
  const structuredModel = extractionModel.withStructuredOutput(chunkRoutingSchema);
  const startedAt = Date.now();

  const result = await withRetry(
    () =>
      structuredModel.invoke([
        {
          role: "system",
          content: `You extract pricing-relevant directives from raw CRM notes, routed to the specific chemical product families they apply to.
Notes use informal names (e.g. "IPA" = Isopropyl Alcohol, "caustic" = Sodium Hydroxide).
For EACH base chemical listed, return only directives that plausibly apply to it or its category — an empty directives array is fine and expected for most families. Return one entry per base chemical listed, even when its directives array is empty.`,
        },
        {
          role: "user",
          content: `Base chemicals:\n${baseChemicals.map((b) => `- ${b}`).join("\n")}\n\nRaw notes:\n${rawNotes
            .map((n, i) => `[${i}] ${n}`)
            .join("\n")}`,
        },
      ]),
    { label: `routeNotes:chunk(${baseChemicals.length})` }
  );

  log("routeNotes", `chunk of ${baseChemicals.length} families routed in ${Date.now() - startedAt}ms`);

  // Same reconciliation pattern as priceSkus: the model can hallucinate a
  // family name outside this chunk's list, or silently drop one. A dropped
  // family just gets no note context below — low-stakes, unlike a missing
  // SKU price, so it doesn't need a force-review flag.
  const expected = new Set(baseChemicals);
  const byFamily = new Map<string, NoteDirective[]>();
  for (const f of result.families) {
    if (!expected.has(f.baseChemical)) continue;
    byFamily.set(f.baseChemical, f.directives);
  }
  return byFamily;
}

export async function routeNotesToFamilies(baseChemicals: string[], rawNotes: string[]): Promise<Map<string, NoteDirective[]>> {
  if (baseChemicals.length === 0) return new Map();

  const chunks = chunk(baseChemicals, CHUNK_SIZE);
  const startedAt = Date.now();
  log("routeNotes", `${baseChemicals.length} families need notes, ${chunks.length} chunk(s) of up to ${CHUNK_SIZE}`);

  const chunkResults = await Promise.all(chunks.map((c) => routeChunk(c, rawNotes)));

  const merged = new Map<string, NoteDirective[]>();
  for (const chunkMap of chunkResults) {
    for (const [family, directives] of chunkMap) merged.set(family, directives);
  }
  for (const b of baseChemicals) if (!merged.has(b)) merged.set(b, []);

  log("routeNotes", `done: ${baseChemicals.length} families in ${Date.now() - startedAt}ms across ${chunks.length} parallel call(s)`);

  return merged;
}
