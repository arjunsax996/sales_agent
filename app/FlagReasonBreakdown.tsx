import { categorizeReviewReason } from "@/lib/reviewReasonCategory";
import type { SerializedProduct } from "./types";

export default function FlagReasonBreakdown({ products }: { products: SerializedProduct[] }) {
  const flagged = products.filter((p) => p.needsHumanReview);
  if (flagged.length === 0) return null;

  const counts = new Map<string, number>();
  for (const p of flagged) {
    const category = categorizeReviewReason(p.reviewReason);
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
      <span className="font-medium uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
        Why flagged:
      </span>
      {sorted.map(([label, count]) => (
        <span key={label} className="rounded-full px-2.5 py-1 font-medium" style={{ background: "var(--amber-soft)", color: "var(--amber)" }}>
          {label} · {count}
        </span>
      ))}
    </div>
  );
}
