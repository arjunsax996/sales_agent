import { familyNeedsReasoning, repriceFamily, routeNotesToFamilies } from "@/agent";
import type { NoteDirective, ProductRow } from "@/agent";
import { persistFamilyResult } from "@/lib/persistFamily";
import { prisma } from "@/lib/prisma";
import { log } from "@/shared/log";
import { inngest } from "./client";

/**
 * Replaces the in-process worker pool (agent/run.ts's repriceCatalog, still
 * used by the CLI seed script) for the web-triggered /batch flow. That pool
 * ran the whole catalog inside one request/response cycle — fine for
 * `next dev`/`next start`, but Vercel's serverless functions kill execution
 * once the response is sent (or hit the max-duration cap first), so a
 * 221-family run just timed out mid-way. Fanning each family out as its own
 * Inngest-triggered event means every HTTP invocation only ever does ONE
 * family's worth of work (~15-30s), well under any serverless timeout, and
 * Inngest durably retries/resumes if a step is interrupted instead of losing
 * progress silently.
 */

type CatalogRequestedData = { jobId: string; products: ProductRow[]; notes: string[] };
type FamilyRequestedData = { jobId: string; baseChemical: string; products: ProductRow[]; noteDirectives: NoteDirective[] };

// Increments the shared BatchJob row and flips it to DONE once every family
// (succeeded or failed) has been accounted for. Both the happy path
// (advance-progress step below) and the per-family onFailure handler call
// this — a family that exhausts retries still needs to count toward "done."
async function advanceJob(jobId: string, field: "familiesDone" | "familiesFailed", currentFamily: string) {
  const job = await prisma.batchJob.update({
    where: { id: jobId },
    data: { [field]: { increment: 1 }, currentFamily },
  });
  if (job.familiesDone + job.familiesFailed >= job.totalFamilies) {
    await prisma.batchJob.update({ where: { id: jobId }, data: { state: "DONE", finishedAt: new Date() } });
  }
}

export const repriceCatalogFn = inngest.createFunction(
  {
    id: "reprice-catalog",
    triggers: { event: "batch/reprice.requested" },
    onFailure: async ({ event, error }) => {
      const { jobId } = event.data.event.data as CatalogRequestedData;
      log("batchJob", `catalog run ${jobId} failed before fan-out: ${error.message}`);
      await prisma.batchJob.update({
        where: { id: jobId },
        data: { state: "ERROR", message: error.message, finishedAt: new Date() },
      });
    },
  },
  async ({ event, step }) => {
    const { jobId, products, notes } = event.data as CatalogRequestedData;

    const families = new Map<string, ProductRow[]>();
    for (const p of products) {
      if (!families.has(p.baseChemical)) families.set(p.baseChemical, []);
      families.get(p.baseChemical)!.push(p);
    }
    const entries = [...families.entries()];

    const reasoningFamilyNames = entries.filter(([, familyProducts]) => familyNeedsReasoning(familyProducts)).map(([name]) => name);

    // Object, not Map — step results are persisted as JSON for durability/replay.
    const notesByFamily = await step.run("route-notes", async () => {
      const map = await routeNotesToFamilies(reasoningFamilyNames, notes);
      return Object.fromEntries(map);
    });

    await step.sendEvent(
      "fan-out-families",
      entries.map(([baseChemical, familyProducts]) => ({
        name: "batch/family.requested" as const,
        data: {
          jobId,
          baseChemical,
          products: familyProducts,
          noteDirectives: notesByFamily[baseChemical] ?? [],
        } satisfies FamilyRequestedData,
      }))
    );

    return { jobId, totalFamilies: entries.length };
  }
);

export const repriceFamilyFn = inngest.createFunction(
  {
    id: "reprice-family",
    triggers: { event: "batch/family.requested" },
    // Capped at 5, not agent/run.ts's CLI worker-pool value (15) — Inngest's
    // free plan rejects a function sync entirely if concurrency exceeds its
    // plan limit (5), which silently left this function unregistered the
    // first time this was deployed. Raise this if the Inngest plan changes.
    concurrency: { limit: 5 },
    retries: 2,
    onFailure: async ({ event, error }) => {
      const { jobId, baseChemical } = event.data.event.data as FamilyRequestedData;
      log("batchJob", `${baseChemical}: failed after retries — ${error.message}`);
      await advanceJob(jobId, "familiesFailed", baseChemical);
    },
  },
  async ({ event, step }) => {
    const { jobId, baseChemical, products, noteDirectives } = event.data as FamilyRequestedData;

    const result = await step.run("reprice", () => repriceFamily(baseChemical, products, noteDirectives));
    await step.run("persist", () => persistFamilyResult(result));
    await step.run("advance-progress", () => advanceJob(jobId, "familiesDone", baseChemical));

    return { baseChemical };
  }
);
