import { formatCurrency, formatPct, formatPlainPct } from "@/lib/format";
import { STATUS_LABEL, type SerializedProduct } from "./types";

const STATUS_STYLE = {
  PENDING: { background: "var(--surface)", color: "var(--text-muted)", border: "1px solid var(--border)" },
  APPROVED: { background: "var(--green-soft)", color: "var(--green)" },
  OVERRIDDEN: { background: "var(--blue-soft)", color: "var(--blue)" },
} as const;

export type SortKey =
  | "baseChemical"
  | "category"
  | "lastYearPrice"
  | "newCost"
  | "effectivePrice"
  | "priceDeltaPct"
  | "marginPct"
  | "winRate"
  | "reviewStatus";

export type SortSpec = { key: SortKey; direction: "asc" | "desc" } | null;

function effectivePrice(p: SerializedProduct): number {
  return p.overridePrice ?? p.recommendedPrice;
}

function priceDeltaPct(p: SerializedProduct): number | null {
  return p.lastYearPrice > 0 ? ((effectivePrice(p) - p.lastYearPrice) / p.lastYearPrice) * 100 : null;
}

// Nulls (no sales history, no last-year price to compare against) always
// sort after real values, regardless of direction — an unknown isn't
// meaningfully "highest" or "lowest."
function compareByKey(a: SerializedProduct, b: SerializedProduct, key: SortKey): number {
  switch (key) {
    case "baseChemical":
      return a.baseChemical.localeCompare(b.baseChemical);
    case "category":
      return a.category.localeCompare(b.category);
    case "lastYearPrice":
      return a.lastYearPrice - b.lastYearPrice;
    case "newCost":
      return a.newCost - b.newCost;
    case "effectivePrice":
      return effectivePrice(a) - effectivePrice(b);
    case "marginPct":
      return a.marginPct - b.marginPct;
    case "reviewStatus":
      return a.reviewStatus.localeCompare(b.reviewStatus);
    case "priceDeltaPct": {
      const da = priceDeltaPct(a);
      const db = priceDeltaPct(b);
      if (da == null) return db == null ? 0 : 1;
      if (db == null) return -1;
      return da - db;
    }
    case "winRate": {
      if (a.winRate == null) return b.winRate == null ? 0 : 1;
      if (b.winRate == null) return -1;
      return a.winRate - b.winRate;
    }
  }
}

export function sortProducts(products: SerializedProduct[], primary: SortSpec, secondary: SortSpec): SerializedProduct[] {
  if (!primary) return products;
  return [...products].sort((a, b) => {
    const primaryCmp = compareByKey(a, b, primary.key) * (primary.direction === "asc" ? 1 : -1);
    if (primaryCmp !== 0 || !secondary) return primaryCmp;
    return compareByKey(a, b, secondary.key) * (secondary.direction === "asc" ? 1 : -1);
  });
}

function SortableHeader({
  label,
  sortKey,
  align = "left",
  sort,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  align?: "left" | "right";
  sort: { primary: SortSpec; secondary: SortSpec };
  onSort: (key: SortKey, additive: boolean) => void;
}) {
  const isPrimary = sort.primary?.key === sortKey;
  const isSecondary = sort.secondary?.key === sortKey;
  const direction = isPrimary ? sort.primary?.direction : isSecondary ? sort.secondary?.direction : null;
  const isActive = direction != null;
  const arrow = direction === "asc" ? "▲" : direction === "desc" ? "▼" : "⇅";

  return (
    <th className={`px-4 py-2.5 font-medium ${align === "right" ? "text-right" : "text-left"}`}>
      <button
        type="button"
        onClick={(e) => onSort(sortKey, e.shiftKey)}
        title="Click to sort, shift-click to set as secondary sort"
        className={`inline-flex items-center gap-1 uppercase tracking-wide ${align === "right" ? "flex-row-reverse" : ""}`}
        style={{ color: isActive ? "var(--text)" : "var(--text-muted)" }}
      >
        {label}
        <span className="text-[10px]" style={{ color: isActive ? "var(--accent)" : "var(--text-muted)", opacity: isActive ? 1 : 0.5 }}>
          {arrow}
          {isSecondary && <sup>2</sup>}
        </span>
      </button>
    </th>
  );
}

export default function ProductTable({
  products,
  selectedSku,
  onSelect,
  sort,
  onSort,
}: {
  products: SerializedProduct[];
  selectedSku?: string | null;
  onSelect: (sku: string) => void;
  sort: { primary: SortSpec; secondary: SortSpec };
  onSort: (key: SortKey, additive: boolean) => void;
}) {
  if (products.length === 0) {
    return (
      <div className="rounded-lg border bg-white px-6 py-16 text-center text-sm" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
        Nothing matches the current filters.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border bg-white" style={{ borderColor: "var(--border)" }}>
      <table className="w-full min-w-[900px] text-sm">
        <thead className="sticky top-0 z-10 bg-white">
          <tr className="border-b text-xs" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
            <SortableHeader label="SKU / Product" sortKey="baseChemical" sort={sort} onSort={onSort} />
            <SortableHeader label="Category" sortKey="category" sort={sort} onSort={onSort} />
            <SortableHeader label="Last yr. price" sortKey="lastYearPrice" align="right" sort={sort} onSort={onSort} />
            <SortableHeader label="New cost" sortKey="newCost" align="right" sort={sort} onSort={onSort} />
            <SortableHeader label="Recommended" sortKey="effectivePrice" align="right" sort={sort} onSort={onSort} />
            <SortableHeader label="Δ Price" sortKey="priceDeltaPct" align="right" sort={sort} onSort={onSort} />
            <SortableHeader label="Margin" sortKey="marginPct" align="right" sort={sort} onSort={onSort} />
            <SortableHeader label="Win rate" sortKey="winRate" align="right" sort={sort} onSort={onSort} />
            <SortableHeader label="Status" sortKey="reviewStatus" sort={sort} onSort={onSort} />
          </tr>
        </thead>
        <tbody>
          {products.map((p) => {
            const delta = priceDeltaPct(p);
            const price = effectivePrice(p);
            const isSelected = p.sku === selectedSku;

            return (
              <tr
                key={p.sku}
                onClick={() => onSelect(p.sku)}
                className="cursor-pointer border-b last:border-0 hover:bg-black/[0.02]"
                style={{
                  borderColor: "var(--border)",
                  background: isSelected ? "var(--accent-soft)" : undefined,
                }}
              >
                <td className="px-4 py-2.5">
                  {/* A real <button>, not tabIndex/role on the <tr> — Safari
                      excludes table-part elements (tr/td) from the tab order
                      even with an explicit role override; a native
                      interactive element sidesteps that entirely. */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect(p.sku);
                    }}
                    className="block w-full rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                  >
                    <div className="font-medium">{p.baseChemical}</div>
                    <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                      {p.sku} &middot; {p.grade || "—"} &middot; {p.packSize || "—"}
                    </div>
                  </button>
                </td>
                <td className="px-4 py-2.5" style={{ color: "var(--text-muted)" }}>
                  {p.category}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatCurrency(p.lastYearPrice)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatCurrency(p.newCost)}</td>
                <td className="px-4 py-2.5 text-right font-medium tabular-nums">
                  {formatCurrency(price)}
                  {p.overridePrice != null && (
                    <span className="ml-1 text-xs font-normal" style={{ color: "var(--text-muted)" }}>
                      (was {formatCurrency(p.recommendedPrice)})
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums" style={{ color: delta != null && delta < 0 ? "var(--blue)" : undefined }}>
                  {delta != null ? formatPct(delta) : "—"}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatPlainPct(p.marginPct)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums" style={{ color: "var(--text-muted)" }}>
                  {p.winRate != null ? formatPlainPct(p.winRate * 100) : "—"}
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-1.5">
                    <span className="rounded-full px-2 py-0.5 text-xs font-medium" style={STATUS_STYLE[p.reviewStatus]}>
                      {STATUS_LABEL[p.reviewStatus]}
                    </span>
                    {p.needsHumanReview && (
                      <span className="rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: "var(--amber-soft)", color: "var(--amber)" }}>
                        Flagged
                      </span>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
