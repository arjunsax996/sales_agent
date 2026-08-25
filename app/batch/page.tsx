"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { BatchJobStatus } from "@/lib/batchJob";
import { checkBatchStatus, uploadAndStartBatch } from "./actions";

export default function BatchPage() {
  const [productsFile, setProductsFile] = useState<File | null>(null);
  const [notesFile, setNotesFile] = useState<File | null>(null);
  const [status, setStatus] = useState<BatchJobStatus>({ state: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  function startPolling() {
    stopPolling();
    pollRef.current = setInterval(async () => {
      const s = await checkBatchStatus();
      setStatus(s);
      if (s.state !== "running") stopPolling();
    }, 2000);
  }

  // Reflect a job already running (started from another tab/session) rather
  // than assuming idle just because this page just mounted.
  useEffect(() => {
    checkBatchStatus().then((s) => {
      setStatus(s);
      if (s.state === "running") startPolling();
    });
    return stopPolling;
  }, []);

  async function handleSubmit() {
    if (!productsFile) return;
    setError(null);
    setSubmitting(true);
    try {
      const productsCsvText = await productsFile.text();
      const notesCsvText = notesFile ? await notesFile.text() : null;
      await uploadAndStartBatch(productsCsvText, notesCsvText);
      const s = await checkBatchStatus();
      setStatus(s);
      startPolling();
    } catch (err) {
      setError((err as Error).message || "Failed to start the batch job.");
    } finally {
      setSubmitting(false);
    }
  }

  const running = status.state === "running";

  return (
    <main className="mx-auto max-w-2xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Batch update</h1>
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          Upload an updated products.csv (and optionally notes.csv) to run the AI repricing agent against it. New SKUs are added;
          existing ones are updated with fresh recommendations. Review status on unaffected SKUs is left untouched.
        </p>
      </header>

      <section className="rounded-lg border bg-white p-5" style={{ borderColor: "var(--border)" }}>
        <div className="space-y-3">
          <FileField label="products.csv" required file={productsFile} onChange={setProductsFile} disabled={running} />
          <FileField label="notes.csv (optional — falls back to the existing note set)" file={notesFile} onChange={setNotesFile} disabled={running} />
        </div>

        <button
          type="button"
          disabled={!productsFile || submitting || running}
          onClick={handleSubmit}
          className="mt-4 rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          style={{ background: "var(--accent)" }}
        >
          {submitting ? "Starting…" : running ? "Running…" : "Run batch update"}
        </button>

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </section>

      <section className="mt-6 rounded-lg border bg-white p-5" style={{ borderColor: "var(--border)" }}>
        <h2 className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
          Status
        </h2>
        <StatusBody status={status} />
      </section>
    </main>
  );
}

function StatusBody({ status }: { status: BatchJobStatus }) {
  if (status.state === "idle") {
    return (
      <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
        No batch job has run this session.
      </p>
    );
  }

  if (status.state === "running") {
    const pct = status.totalFamilies > 0 ? Math.round((status.familiesDone / status.totalFamilies) * 100) : 0;
    return (
      <div className="mt-2">
        <div className="flex items-center justify-between text-sm">
          <span>
            {status.familiesDone} / {status.totalFamilies} families processed
          </span>
          <span style={{ color: "var(--text-muted)" }}>{pct}%</span>
        </div>
        <div className="mt-1.5 h-2 overflow-hidden rounded-full" style={{ background: "var(--accent-soft)" }}>
          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: "var(--accent)" }} />
        </div>
        {status.currentFamily && (
          <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
            Last completed: {status.currentFamily}
          </p>
        )}
      </div>
    );
  }

  if (status.state === "done") {
    return (
      <div className="mt-2 text-sm">
        <p style={{ color: "var(--green)" }}>
          Done — {status.familiesDone} of {status.totalFamilies} families persisted{status.familiesFailed > 0 ? `, ${status.familiesFailed} failed` : ""}.
        </p>
        <Link href="/" className="mt-2 inline-block font-medium" style={{ color: "var(--accent)" }}>
          Go to Review →
        </Link>
      </div>
    );
  }

  return (
    <p className="mt-2 text-sm text-red-600">
      Failed: {status.message}
    </p>
  );
}

function FileField({
  label,
  file,
  onChange,
  required,
  disabled,
}: {
  label: string;
  file: File | null;
  onChange: (file: File | null) => void;
  required?: boolean;
  disabled?: boolean;
}) {
  return (
    <label className="block text-sm font-medium">
      {label}
      {required ? " *" : ""}
      <input
        type="file"
        accept=".csv,text/csv"
        disabled={disabled}
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
        className="mt-1 block w-full text-sm"
      />
      {file && (
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          {file.name}
        </span>
      )}
    </label>
  );
}
