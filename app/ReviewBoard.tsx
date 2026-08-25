"use client";

import { useMemo, useState, useTransition } from "react";
import { bulkApproveUnflagged } from "./actions";
import FlagReasonBreakdown from "./FlagReasonBreakdown";
import ProductDrawer from "./ProductDrawer";
import ProductTable from "./ProductTable";
import StatsBar from "./StatsBar";
import type { SerializedProduct } from "./types";

type Tab = "flagged" | "pending" | "approved" | "overridden" | "all";

const PAGE_SIZE = 50;

export default function ReviewBoard({ products }: { products: SerializedProduct[] }) {
  const flaggedCount = products.filter((p) => p.needsHumanReview).length;
  const [tab, setTab] = useState<Tab>(flaggedCount > 0 ? "flagged" : "pending");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [selectedSku, setSelectedSku] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [isPending, startTransition] = useTransition();

  const categories = useMemo(() => [...new Set(products.map((p) => p.category))].sort(), [products]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (tab === "flagged" && !p.needsHumanReview) return false;
      if (tab === "pending" && (p.reviewStatus !== "PENDING" || p.needsHumanReview)) return false;
      if (tab === "approved" && p.reviewStatus !== "APPROVED") return false;
      if (tab === "overridden" && p.reviewStatus !== "OVERRIDDEN") return false;
      if (category !== "all" && p.category !== category) return false;
      if (q && !`${p.sku} ${p.baseChemical} ${p.grade} ${p.packSize}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [products, tab, search, category]);

  const selected = products.find((p) => p.sku === selectedSku) ?? null;
  const unflaggedPending = products.filter((p) => !p.needsHumanReview && p.reviewStatus === "PENDING").length;

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const paginated = filtered.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE);

  function changeFilter(fn: () => void) {
    fn();
    setPage(0);
  }

  // After acting on a row, jump to the next one in the current view that
  // still needs a decision — skips anything already approved/overridden
  // (e.g. in an earlier session) rather than stopping on it, and wraps
  // around so a mid-list starting point still covers the whole queue.
  function advanceToNext() {
    const idx = filtered.findIndex((p) => p.sku === selectedSku);
    if (idx === -1) {
      setSelectedSku(null);
      return;
    }
    for (let offset = 1; offset < filtered.length; offset++) {
      const candidateIdx = (idx + offset) % filtered.length;
      const candidate = filtered[candidateIdx];
      if (candidate.reviewStatus === "PENDING") {
        setSelectedSku(candidate.sku);
        setPage(Math.floor(candidateIdx / PAGE_SIZE));
        return;
      }
    }
    setSelectedSku(null);
  }

  if (products.length === 0) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-24 text-center">
        <h1 className="text-xl font-semibold">No recommendations yet</h1>
        <p className="mt-2" style={{ color: "var(--text-muted)" }}>
          Run <code className="rounded bg-black/5 px-1.5 py-0.5">npm run seed</code> with an <code className="rounded bg-black/5 px-1.5 py-0.5">OPENAI_API_KEY</code> set
          to generate AI price recommendations for the catalog.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-[1400px] px-6 py-8">
      <header className="mb-6 flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Repricing review</h1>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            AI-generated recommendations for next year&apos;s catalog. Review the flagged items, approve or override the rest.
          </p>
        </div>
        {unflaggedPending > 0 && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => startTransition(async () => { await bulkApproveUnflagged(); })}
            className="shrink-0 rounded-md px-4 py-2 text-sm font-medium text-white shadow-sm disabled:opacity-50"
            style={{ background: "var(--accent)" }}
          >
            {isPending
              ? "Approving…"
              : `Approve ${unflaggedPending} unflagged recommendation${unflaggedPending === 1 ? "" : "s"}`}
          </button>
        )}
      </header>

      <div className="mb-4">
        <StatsBar products={products} />
      </div>

      <FlagReasonBreakdown products={products} />

      <div className="mb-3 flex items-center gap-2">
        {(
          [
            ["flagged", `Needs review (${flaggedCount})`],
            ["pending", `Pending (${unflaggedPending})`],
            ["approved", "Approved"],
            ["overridden", "Overridden"],
            ["all", "All"],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => changeFilter(() => setTab(key))}
            className="rounded-full px-3 py-1.5 text-sm font-medium transition"
            style={
              tab === key
                ? { background: "var(--accent-soft)", color: "var(--accent)" }
                : { background: "var(--surface)", color: "var(--text-muted)", border: "1px solid var(--border)" }
            }
          >
            {label}
          </button>
        ))}

        <div className="ml-auto flex items-center gap-2">
          <select
            value={category}
            onChange={(e) => changeFilter(() => setCategory(e.target.value))}
            aria-label="Filter by category"
            className="rounded-md border px-2 py-1.5 text-sm"
            style={{ borderColor: "var(--border)" }}
          >
            <option value="all">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <input
            value={search}
            onChange={(e) => changeFilter(() => setSearch(e.target.value))}
            placeholder="Search SKU or chemical..."
            aria-label="Search SKU or chemical"
            className="w-64 rounded-md border px-3 py-1.5 text-sm"
            style={{ borderColor: "var(--border)" }}
          />
        </div>
      </div>

      <ProductTable products={paginated} selectedSku={selectedSku} onSelect={setSelectedSku} />

      {filtered.length > 0 && (
        <div className="mt-3 flex items-center justify-between text-sm" style={{ color: "var(--text-muted)" }}>
          <span>
            Showing {currentPage * PAGE_SIZE + 1}–{Math.min(filtered.length, currentPage * PAGE_SIZE + PAGE_SIZE)} of{" "}
            {filtered.length}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
              className="rounded-md border px-3 py-1.5 font-medium disabled:opacity-40"
              style={{ borderColor: "var(--border)" }}
            >
              Previous
            </button>
            <span>
              Page {currentPage + 1} of {pageCount}
            </span>
            <button
              type="button"
              disabled={currentPage >= pageCount - 1}
              onClick={() => setPage(currentPage + 1)}
              className="rounded-md border px-3 py-1.5 font-medium disabled:opacity-40"
              style={{ borderColor: "var(--border)" }}
            >
              Next
            </button>
          </div>
        </div>
      )}

      {selected && <ProductDrawer product={selected} onClose={() => setSelectedSku(null)} onActed={advanceToNext} />}
    </main>
  );
}
