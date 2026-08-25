"use server";

import { loadNotes, parseNotesCsv, parseProductsCsv } from "@/agent";
import { type BatchJobStatus, getBatchJobStatus, isBatchJobRunning, startBatchJob } from "@/lib/batchJob";

export async function uploadAndStartBatch(productsCsvText: string, notesCsvText: string | null): Promise<{ totalFamilies: number }> {
  if (isBatchJobRunning()) throw new Error("A batch job is already running — wait for it to finish before starting another.");
  if (!process.env.OPENAI_API_KEY?.trim()) {
    throw new Error("OPENAI_API_KEY isn't set on the server — the batch agent needs it to generate recommendations.");
  }

  const products = parseProductsCsv(productsCsvText);
  if (products.length === 0) throw new Error("No products found in the uploaded CSV.");

  // Notes are optional per upload — fall back to the bundled default set so a
  // cost-only update still gets the benefit of existing CRM context.
  const notes = notesCsvText ? parseNotesCsv(notesCsvText) : loadNotes("data/notes.csv");

  const totalFamilies = startBatchJob(products, notes);
  return { totalFamilies };
}

export async function checkBatchStatus(): Promise<BatchJobStatus> {
  return getBatchJobStatus();
}
