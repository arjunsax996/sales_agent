import { formatCompactCurrency } from "@/lib/format";
import type { SerializedProduct } from "./types";

export default function StatsBar({ products }: { products: SerializedProduct[] }) {
  const total = products.length;
  const needsReview = products.filter((p) => p.needsHumanReview).length;
  const approved = products.filter((p) => p.reviewStatus === "APPROVED").length;
  const overridden = products.filter((p) => p.reviewStatus === "OVERRIDDEN").length;
  const reviewed = approved + overridden;
  const flaggedImpact = products.filter((p) => p.needsHumanReview).reduce((sum, p) => sum + p.revenueImpact, 0);

  const stats = [
    { label: "Total SKUs", value: total.toLocaleString() },
    { label: "Needs review", value: needsReview.toLocaleString(), tone: "amber" as const },
    { label: "Reviewed", value: `${reviewed.toLocaleString()} / ${total.toLocaleString()}`, tone: "green" as const },
    { label: "Overridden", value: overridden.toLocaleString(), tone: "blue" as const },
    { label: "$ at stake in flagged SKUs", value: formatCompactCurrency(flaggedImpact) },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {stats.map((s) => (
        <div key={s.label} className="rounded-lg border bg-white px-4 py-3" style={{ borderColor: "var(--border)" }}>
          <div className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
            {s.label}
          </div>
          <div
            className="mt-1 text-2xl font-semibold"
            style={s.tone ? { color: `var(--${s.tone})` } : undefined}
          >
            {s.value}
          </div>
        </div>
      ))}
    </div>
  );
}
