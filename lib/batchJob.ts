import { prisma } from "./prisma";

/**
 * Durable status for a /batch run — a Postgres row (prisma/schema.prisma's
 * BatchJob model), not the in-memory singleton this used to be. That
 * singleton couldn't survive Vercel's serverless runtime: progress lived in
 * one function invocation's memory, which the platform can kill once the
 * triggering request's response is sent, and a separate invocation
 * polling status wouldn't even see the same memory. The actual work now
 * runs via Inngest (lib/inngest/functions.ts), which advances this row from
 * each family's own short-lived invocation.
 */
export type BatchJobStatus =
  | { state: "idle" }
  | { state: "running"; totalFamilies: number; familiesDone: number; currentFamily: string | null; startedAt: string }
  | { state: "done"; totalFamilies: number; familiesDone: number; familiesFailed: number; startedAt: string; finishedAt: string }
  | { state: "error"; message: string; startedAt: string; finishedAt: string };

export async function getBatchJobStatus(): Promise<BatchJobStatus> {
  const job = await prisma.batchJob.findFirst({ orderBy: { startedAt: "desc" } });
  if (!job) return { state: "idle" };

  if (job.state === "RUNNING") {
    return {
      state: "running",
      totalFamilies: job.totalFamilies,
      familiesDone: job.familiesDone,
      currentFamily: job.currentFamily,
      startedAt: job.startedAt.toISOString(),
    };
  }

  if (job.state === "DONE") {
    return {
      state: "done",
      totalFamilies: job.totalFamilies,
      familiesDone: job.familiesDone,
      familiesFailed: job.familiesFailed,
      startedAt: job.startedAt.toISOString(),
      finishedAt: job.finishedAt!.toISOString(),
    };
  }

  return {
    state: "error",
    message: job.message ?? "Unknown error",
    startedAt: job.startedAt.toISOString(),
    finishedAt: job.finishedAt!.toISOString(),
  };
}

export async function isBatchJobRunning(): Promise<boolean> {
  const job = await prisma.batchJob.findFirst({ orderBy: { startedAt: "desc" } });
  return job?.state === "RUNNING";
}
