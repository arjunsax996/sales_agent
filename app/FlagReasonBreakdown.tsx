import { categorizeReviewReason } from "@/lib/reviewReasonCategory";
import type { SerializedProduct } from "./types";

export default function FlagReasonBreakdown({
  products,
  selectedReasons,
  onSelectReason,
  onClear,
}: {
  products: SerializedProduct[];
  selectedReasons: Set<string>;
  onSelectReason: (label: string) => void;
  onClear: () => void;
}) {
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
      {sorted.map(([label, count]) => {
        const isActive = selectedReasons.has(label);
        return (
          <button
            key={label}
            type="button"
            onClick={() => onSelectReason(label)}
            aria-pressed={isActive}
            title={isActive ? "Click to remove this filter" : `Add filter: SKUs flagged for ${label}`}
            className="rounded-full px-2.5 py-1 font-medium transition"
            style={isActive ? { background: "var(--amber)", color: "white" } : { background: "var(--amber-soft)", color: "var(--amber)" }}
          >
            {label} · {count}
          </button>
        );
      })}
      {selectedReasons.size > 0 && (
        <button type="button" onClick={onClear} className="font-medium underline" style={{ color: "var(--text-muted)" }}>
          Clear ({selectedReasons.size})
        </button>
      )}
    </div>
  );
}
