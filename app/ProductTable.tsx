import { formatCurrency, formatPct, formatPlainPct } from "@/lib/format";
import { STATUS_LABEL, type SerializedProduct } from "./types";

const STATUS_STYLE = {
  PENDING: { background: "var(--surface)", color: "var(--text-muted)", border: "1px solid var(--border)" },
  APPROVED: { background: "var(--green-soft)", color: "var(--green)" },
  OVERRIDDEN: { background: "var(--blue-soft)", color: "var(--blue)" },
} as const;

export default function ProductTable({
  products,
  selectedSku,
  onSelect,
}: {
  products: SerializedProduct[];
  selectedSku?: string | null;
  onSelect: (sku: string) => void;
}) {
  if (products.length === 0) {
    return (
      <div className="rounded-lg border bg-white px-6 py-16 text-center text-sm" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
        Nothing matches the current filters.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border bg-white" style={{ borderColor: "var(--border)" }}>
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10 bg-white">
          <tr className="border-b text-left text-xs uppercase tracking-wide" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
            <th className="px-4 py-2.5 font-medium">SKU / Product</th>
            <th className="px-4 py-2.5 font-medium">Category</th>
            <th className="px-4 py-2.5 text-right font-medium">Last yr. price</th>
            <th className="px-4 py-2.5 text-right font-medium">New cost</th>
            <th className="px-4 py-2.5 text-right font-medium">Recommended</th>
            <th className="px-4 py-2.5 text-right font-medium">Δ Price</th>
            <th className="px-4 py-2.5 text-right font-medium">Margin</th>
            <th className="px-4 py-2.5 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {products.map((p) => {
            const effectivePrice = p.overridePrice ?? p.recommendedPrice;
            const priceDeltaPct = p.lastYearPrice > 0 ? ((effectivePrice - p.lastYearPrice) / p.lastYearPrice) * 100 : null;

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
                  <div className="font-medium">{p.baseChemical}</div>
                  <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {p.sku} &middot; {p.grade || "—"} &middot; {p.packSize || "—"}
                  </div>
                </td>
                <td className="px-4 py-2.5" style={{ color: "var(--text-muted)" }}>
                  {p.category}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatCurrency(p.lastYearPrice)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatCurrency(p.newCost)}</td>
                <td className="px-4 py-2.5 text-right font-medium tabular-nums">
                  {formatCurrency(effectivePrice)}
                  {p.overridePrice != null && (
                    <span className="ml-1 text-xs font-normal" style={{ color: "var(--text-muted)" }}>
                      (was {formatCurrency(p.recommendedPrice)})
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums" style={{ color: priceDeltaPct != null && priceDeltaPct < 0 ? "var(--blue)" : undefined }}>
                  {priceDeltaPct != null ? formatPct(priceDeltaPct) : "—"}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatPlainPct(p.marginPct)}</td>
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
