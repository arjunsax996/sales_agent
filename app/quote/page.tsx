"use client";

import { useState, useTransition } from "react";
import { formatCurrency } from "@/lib/format";
import type { QuoteEmail } from "@/quote-agent/draft-email";
import type { Quotation, QuoteRequestItem } from "@/quote-agent/types";
import { generateQuote } from "./actions";

type Row = QuoteRequestItem;
type Result = Quotation & { mode: "llm" | "placeholder"; email: QuoteEmail };

// Exactly the units that actually appear in data/products.csv's pack sizes —
// confirmed by scanning every row; "L" (liters) is supported by unit-utils.ts
// but never actually used in this catalog, so it's not offered here.
const UNITS = ["mL", "Gal", "g", "kg", "lb"];
const EMPTY_ROW: Row = { chemicalName: "", quantity: 1, unit: "kg" };

export default function QuotePage() {
  const [companyName, setCompanyName] = useState("");
  const [rows, setRows] = useState<Row[]>([{ ...EMPTY_ROW }]);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();

  function updateRow(index: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows((prev) => [...prev, { ...EMPTY_ROW }]);
  }

  function removeRow(index: number) {
    setRows((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  }

  function handleSubmit() {
    setError(null);
    setCopied(false);
    startTransition(async () => {
      try {
        const quote = await generateQuote(companyName, rows);
        setResult(quote);
      } catch (err) {
        setResult(null);
        setError((err as Error).message || "Failed to generate quote.");
      }
    });
  }

  function handleCopy() {
    if (!result) return;
    navigator.clipboard.writeText(`Subject: ${result.email.subject}\n\n${result.email.body}`).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">New quote</h1>
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          Enter what a customer is asking for — informal names are fine (&quot;IPA&quot;, &quot;caustic soda&quot;), matched against the
          catalog&apos;s current AI-recommended prices.
        </p>
      </header>

      <section className="rounded-lg border bg-white p-5" style={{ borderColor: "var(--border)" }}>
        <label className="block text-sm font-medium">
          Company name
          <input
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            placeholder="Acme Corp"
            className="mt-1 block w-full rounded-md border px-3 py-1.5 text-sm"
            style={{ borderColor: "var(--border)" }}
          />
        </label>

        <div className="mt-4 space-y-2">
          {rows.map((row, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                value={row.chemicalName}
                onChange={(e) => updateRow(i, { chemicalName: e.target.value })}
                placeholder="Chemical name"
                className="flex-1 rounded-md border px-3 py-1.5 text-sm"
                style={{ borderColor: "var(--border)" }}
              />
              <input
                type="number"
                min="0"
                value={row.quantity}
                onChange={(e) => updateRow(i, { quantity: Number(e.target.value) })}
                className="w-24 rounded-md border px-3 py-1.5 text-sm tabular-nums"
                style={{ borderColor: "var(--border)" }}
              />
              <select
                value={row.unit}
                onChange={(e) => updateRow(i, { unit: e.target.value })}
                className="w-20 rounded-md border px-2 py-1.5 text-sm"
                style={{ borderColor: "var(--border)" }}
              >
                {UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => removeRow(i)}
                disabled={rows.length === 1}
                className="rounded-md px-2 py-1.5 text-sm disabled:opacity-30"
                style={{ color: "var(--text-muted)" }}
              >
                Remove
              </button>
            </div>
          ))}
        </div>

        <div className="mt-3 flex items-center justify-between">
          <button type="button" onClick={addRow} className="text-sm font-medium" style={{ color: "var(--accent)" }}>
            + Add item
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={handleSubmit}
            className="rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            style={{ background: "var(--accent)" }}
          >
            {isPending ? "Generating…" : "Generate quote"}
          </button>
        </div>

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </section>

      {result && (
        <>
          {result.mode === "placeholder" && (
            <p className="mt-6 rounded-md px-3 py-2 text-sm" style={{ background: "var(--amber-soft)", color: "var(--amber)" }}>
              No OpenAI API key configured — matched using a plain substring search, and the email below is templated rather than
              AI-written. Informal names like &quot;IPA&quot; won&apos;t resolve in this mode.
            </p>
          )}

          <section className="mt-6 rounded-lg border bg-white p-5" style={{ borderColor: "var(--border)" }}>
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                Draft email to {result.companyName}
              </h2>
              <button
                type="button"
                onClick={handleCopy}
                className="rounded-md border px-3 py-1 text-xs font-medium"
                style={{ borderColor: "var(--border)", color: copied ? "var(--green)" : "var(--text-muted)" }}
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
            <p className="mt-3 text-sm font-semibold">{result.email.subject}</p>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{result.email.body}</p>
          </section>

          <section className="mt-4 rounded-lg border bg-white p-5" style={{ borderColor: "var(--border)" }}>
            <h2 className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
              Itemized breakdown (internal)
            </h2>

            <div className="mt-3 overflow-hidden rounded-lg border" style={{ borderColor: "var(--border)" }}>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
                    <th className="px-4 py-2.5 font-medium">Requested</th>
                    <th className="px-4 py-2.5 font-medium">Matched product</th>
                    <th className="px-4 py-2.5 text-right font-medium">Unit price</th>
                    <th className="px-4 py-2.5 text-right font-medium">Units</th>
                    <th className="px-4 py-2.5 text-right font-medium">Line total</th>
                  </tr>
                </thead>
                <tbody>
                  {result.lineItems.map((li, i) => (
                    <tr key={i} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                      <td className="px-4 py-2.5">
                        {li.requested.chemicalName} ({li.requested.quantity} {li.requested.unit})
                      </td>
                      <td className="px-4 py-2.5">
                        {li.matchedProductLabel ?? <span style={{ color: "var(--text-muted)" }}>Unmatched</span>}
                        {li.needsHumanReview && (
                          <div className="mt-0.5 text-xs" style={{ color: "var(--amber)" }}>
                            {li.reviewReason}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{li.unitPrice != null ? formatCurrency(li.unitPrice) : "—"}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{li.unitsNeeded ?? "—"}</td>
                      <td className="px-4 py-2.5 text-right font-medium tabular-nums">{li.lineTotal != null ? formatCurrency(li.lineTotal) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex items-center justify-between text-sm">
              <span style={{ color: "var(--amber)" }}>{result.itemsNeedingReview > 0 ? `${result.itemsNeedingReview} item(s) need review` : "All items resolved cleanly"}</span>
              <span className="text-lg font-semibold">Subtotal: {formatCurrency(result.subtotal)}</span>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
