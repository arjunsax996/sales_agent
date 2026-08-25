"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";

function assertFinitePositive(price: number) {
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error("Price must be a positive number.");
  }
}

export async function approveProduct(sku: string) {
  if (!sku) throw new Error("sku is required");

  await prisma.product.update({
    where: { sku },
    data: { reviewStatus: "APPROVED", overridePrice: null, overrideNote: null, reviewedAt: new Date() },
  });

  revalidatePath("/");
}

export async function overrideProduct(sku: string, price: number, note: string) {
  if (!sku) throw new Error("sku is required");
  assertFinitePositive(price);

  await prisma.product.update({
    where: { sku },
    data: { reviewStatus: "OVERRIDDEN", overridePrice: price, overrideNote: note.trim() || null, reviewedAt: new Date() },
  });

  revalidatePath("/");
}

export async function resetProduct(sku: string) {
  if (!sku) throw new Error("sku is required");

  await prisma.product.update({
    where: { sku },
    data: { reviewStatus: "PENDING", overridePrice: null, overrideNote: null, reviewedAt: null },
  });

  revalidatePath("/");
}

// Bulk-approve every SKU the AI didn't flag — this is the scale lever: most
// of the catalog needs no human judgment call at all, so let a reviewer clear
// it in one click and spend their attention on the flagged minority instead.
export async function bulkApproveUnflagged() {
  const result = await prisma.product.updateMany({
    where: { needsHumanReview: false, reviewStatus: "PENDING" },
    data: { reviewStatus: "APPROVED", reviewedAt: new Date() },
  });

  revalidatePath("/");
  return result.count;
}
