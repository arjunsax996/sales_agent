import { z } from "zod";
import { extractionModel } from "../models";
import type { RepricingStateT } from "../state";
import { log } from "../../shared/log";

/**
 * Pull the notes relevant to this family out of the raw CRM dump. notes.csv
 * uses informal names ("IPA", "caustic") so this is a real extraction/
 * resolution step, not a filter.
 */

const noteDirectivesSchema = z.object({
  directives: z.array(
    z.object({
      summary: z.string(),
      sentiment: z.enum(["pressure_down", "pressure_up", "risk", "neutral"]),
      sourceNoteExcerpt: z.string(),
    })
  ),
});

export async function extractNotes(state: RepricingStateT): Promise<Partial<RepricingStateT>> {
  const structuredModel = extractionModel.withStructuredOutput(noteDirectivesSchema);

  let result: z.infer<typeof noteDirectivesSchema>;
  try {
    result = await structuredModel.invoke([
      {
        role: "system",
        content: `You extract pricing-relevant directives from raw CRM notes for one chemical product family.
Notes use informal names (e.g. "IPA" = Isopropyl Alcohol, "caustic" = Sodium Hydroxide).
Only return directives that plausibly apply to "${state.baseChemical}" or its category — an empty list is fine.`,
      },
      {
        role: "user",
        content: `Base chemical: ${state.baseChemical}\n\nRaw notes:\n${state.rawNotes
          .map((n, i) => `[${i}] ${n}`)
          .join("\n")}`,
      },
    ]);
  } catch (err) {
    throw new Error(`extractNotes failed for family "${state.baseChemical}": ${(err as Error).message}`, { cause: err });
  }

  log("extractNotes", `${state.baseChemical}: ${result.directives.length} directive(s) extracted from ${state.rawNotes.length} raw notes`);

  return { noteDirectives: result.directives };
}
