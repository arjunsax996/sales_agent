"use client";

import { useEffect, useState, useTransition } from "react";
import { formatCurrency, formatPlainPct } from "@/lib/format";
import { approveProduct, overrideProduct, resetProduct } from "./actions";
import { STATUS_LABEL, type SerializedProduct } from "./types";

export default function ProductDrawer({
  product,
  onClose,
  onActed,
}: {
  product: SerializedProduct;
  onClose: () => void;
  onActed: () => void;
}) {
  const [price, setPrice] = useState(String(product.overridePrice ?? product.recommendedPrice));
  const [note, setNote] = useState(product.overrideNote ?? "");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPrice(String(product.overridePrice ?? product.recommendedPrice));
    setNote(product.overrideNote ?? "");
    setError(null);
  }, [product.sku, product.overridePrice, product.overrideNote, product.recommendedPrice]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function handleApprove() {
    setError(null);
    startTransition(async () => {
      await approveProduct(product.sku);
      onActed();
    });
  }

  function handleSaveOverride() {
    setError(null);
    const parsed = Number(price);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError("Enter a valid positive price.");
      return;
    }
    startTransition(async () => {
      await overrideProduct(product.sku, parsed, note);
      onActed();
    });
  }

  function handleReset() {
    setError(null);
    startTransition(async () => {
      await resetProduct(product.sku);
    });
  }

  return (
    <div className="fixed inset-0 z-20 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative flex h-full w-[480px] flex-col overflow-y-auto bg-white shadow-xl" style={{ borderLeft: "1px solid var(--border)" }}>
        <div className="flex items-start justify-between border-b px-5 py-4" style={{ borderColor: "var(--border)" }}>
          <div>
            <div className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
              {product.sku}
            </div>
            <h2 className="text-lg font-semibold">{product.baseChemical}</h2>
            <div className="text-sm" style={{ color: "var(--text-muted)" }}>
              {product.grade || "—"} &middot; {product.packSize || "—"} &middot; {product.category}
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-sm" style={{ color: "var(--text-muted)" }}>
            Close
          </button>
        </div>

        <div className="flex-1 space-y-5 px-5 py-4">
          <section className="grid grid-cols-3 gap-3 text-sm">
            <Metric label="Last yr. price" value={formatCurrency(product.lastYearPrice)} />
            <Metric label="Last yr. cost" value={formatCurrency(product.lastYearCost)} />
            <Metric label="This yr. cost" value={formatCurrency(product.newCost)} />
            <Metric label="Last yr. revenue" value={formatCurrency(product.lastYearRevenue)} />
            <Metric label="Win rate" value={product.winRate != null ? formatPlainPct(product.winRate * 100) : "No history"} />
            <Metric label="Recommended margin" value={formatPlainPct(product.marginPct)} />
          </section>

          {product.needsHumanReview && product.reviewReason && (
            <section className="rounded-md px-3 py-2.5 text-sm" style={{ background: "var(--amber-soft)", color: "var(--amber)" }}>
              <div className="font-medium">Why this needs review</div>
              <div className="mt-0.5">{product.reviewReason}</div>
            </section>
          )}

          <section>
            <h3 className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
              SKU rationale
            </h3>
            <p className="mt-1 text-sm leading-relaxed">{product.rationale}</p>
          </section>

          {product.familyRationale && (
            <section>
              <h3 className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                Family strategy — {product.baseChemical}
                {product.familyTargetMarginDeltaPct != null && (
                  <span className="ml-1 font-normal normal-case" style={{ color: "var(--text-muted)" }}>
                    (target margin {product.familyTargetMarginDeltaPct >= 0 ? "+" : ""}
                    {product.familyTargetMarginDeltaPct.toFixed(1)}pt vs. last year)
                  </span>
                )}
              </h3>
              <p className="mt-1 text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>
                {product.familyRationale}
              </p>
              {product.familyCitedNotes.length > 0 && (
                <div className="mt-2">
                  <div className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                    Source notes cited
                  </div>
                  <ul className="mt-1 space-y-1">
                    {product.familyCitedNotes.map((note, i) => (
                      <li key={i} className="rounded border-l-2 pl-2 text-sm italic" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
                        &ldquo;{note}&rdquo;
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )}

          <section className="rounded-md border p-3" style={{ borderColor: "var(--border)" }}>
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                Set price
              </h3>
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                Status: {STATUS_LABEL[product.reviewStatus]}
              </span>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <span className="text-sm" style={{ color: "var(--text-muted)" }}>
                $
              </span>
              <input
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                inputMode="decimal"
                className="w-32 rounded-md border px-2 py-1.5 text-sm tabular-nums"
                style={{ borderColor: "var(--border)" }}
              />
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                AI recommended {formatCurrency(product.recommendedPrice)}
              </span>
            </div>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional note explaining the override..."
              rows={2}
              className="mt-2 w-full rounded-md border px-2 py-1.5 text-sm"
              style={{ borderColor: "var(--border)" }}
            />
            {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
          </section>
        </div>

        <div className="flex items-center gap-2 border-t px-5 py-4" style={{ borderColor: "var(--border)" }}>
          <button
            type="button"
            disabled={isPending}
            onClick={handleApprove}
            className="flex-1 rounded-md px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            style={{ background: "var(--green)" }}
          >
            {isPending ? "Approving…" : "Approve AI price"}
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={handleSaveOverride}
            className="flex-1 rounded-md px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            style={{ background: "var(--accent)" }}
          >
            {isPending ? "Saving…" : "Save override"}
          </button>
          {product.reviewStatus !== "PENDING" && (
            <button
              type="button"
              disabled={isPending}
              onClick={handleReset}
              className="rounded-md border px-3 py-2 text-sm font-medium disabled:opacity-50"
              style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
            >
              {isPending ? "Resetting…" : "Reset"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs" style={{ color: "var(--text-muted)" }}>
        {label}
      </div>
      <div className="font-medium tabular-nums">{value}</div>
    </div>
  );
}
