import type { Product, ReviewStatus } from "@prisma/client";

// Product, but with Date fields as ISO strings — what actually crosses the
// server -> client component boundary from app/page.tsx.
export type SerializedProduct = Omit<Product, "reviewedAt" | "createdAt" | "updatedAt"> & {
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type { ReviewStatus };

export const STATUS_LABEL: Record<ReviewStatus, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  OVERRIDDEN: "Overridden",
};
