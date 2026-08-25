import { repriceCatalog } from "../agent";
import type { ProductRow } from "../agent/types";
import { persistFamilyResult } from "./persistFamily";

/**
 * In-process job status for a batch reprice triggered from the web app
 * (app/batch/actions.ts), polled by app/batch/page.tsx. Deliberately just a
 * module-level variable, not a DB table — this app runs as one Node process
 * in dev/self-hosted deployments, which is enough for a single-operator
 * "kick off a reprice, watch it finish" flow.
 *
 * Known limitation: on Vercel's standard serverless runtime, a long-running
 * job like this isn't guaranteed to keep executing after the triggering
 * request returns, and this status wouldn't be visible across separate
 * function invocations anyway. This works correctly under `next dev` /
 * `next start` (one persistent process) — a real deployment would need this
 * moved to an actual job queue (Inngest, per the README's other TODOs).
 */
export type BatchJobStatus =
  | { state: "idle" }
  | { state: "running"; totalFamilies: number; familiesDone: number; currentFamily: string | null; startedAt: string }
  | { state: "done"; totalFamilies: number; familiesDone: number; familiesFailed: number; startedAt: string; finishedAt: string }
  | { state: "error"; message: string; startedAt: string; finishedAt: string };

let status: BatchJobStatus = { state: "idle" };

export function getBatchJobStatus(): BatchJobStatus {
  return status;
}

export function isBatchJobRunning(): boolean {
  return status.state === "running";
}

// Fire-and-forget: the caller does not await this to completion. It updates
// the module-level `status` as each family lands, polled separately.
export function startBatchJob(products: ProductRow[], notes: string[]): number {
  if (status.state === "running") throw new Error("A batch job is already running.");

  const totalFamilies = new Set(products.map((p) => p.baseChemical)).size;
  const startedAt = new Date().toISOString();
  status = { state: "running", totalFamilies, familiesDone: 0, currentFamily: null, startedAt };

  repriceCatalog(products, notes, async (result) => {
    await persistFamilyResult(result);
    if (status.state !== "running") return; // shouldn't happen, but don't resurrect a finished job
    status = { ...status, familiesDone: status.familiesDone + 1, currentFamily: result.baseChemical };
  })
    .then((results) => {
      status = {
        state: "done",
        totalFamilies,
        familiesDone: results.length,
        familiesFailed: totalFamilies - results.length,
        startedAt,
        finishedAt: new Date().toISOString(),
      };
    })
    .catch((err) => {
      status = { state: "error", message: (err as Error).message, startedAt, finishedAt: new Date().toISOString() };
    });

  return totalFamilies;
}
