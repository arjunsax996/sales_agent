import { prisma } from "@/lib/prisma";
import ReviewBoard from "./ReviewBoard";

export const dynamic = "force-dynamic";

export default async function Home() {
  const products = await prisma.product.findMany({
    orderBy: [{ needsHumanReview: "desc" }, { revenueImpact: "desc" }],
  });

  const serializable = products.map((p) => ({
    ...p,
    reviewedAt: p.reviewedAt ? p.reviewedAt.toISOString() : null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  }));

  return <ReviewBoard products={serializable} />;
}
