-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'OVERRIDDEN');

-- CreateTable
CREATE TABLE "Product" (
    "sku" TEXT NOT NULL,
    "baseChemical" TEXT NOT NULL,
    "grade" TEXT NOT NULL,
    "packSize" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "lastYearCost" DOUBLE PRECISION NOT NULL,
    "lastYearPrice" DOUBLE PRECISION NOT NULL,
    "newCost" DOUBLE PRECISION NOT NULL,
    "lastYearRevenue" DOUBLE PRECISION NOT NULL,
    "winRate" DOUBLE PRECISION,
    "recommendedPrice" DOUBLE PRECISION NOT NULL,
    "marginPct" DOUBLE PRECISION NOT NULL,
    "rationale" TEXT NOT NULL,
    "needsHumanReview" BOOLEAN NOT NULL DEFAULT false,
    "reviewReason" TEXT,
    "familyRationale" TEXT,
    "familyTargetMarginDeltaPct" DOUBLE PRECISION,
    "revenueImpact" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reviewStatus" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "overridePrice" DOUBLE PRECISION,
    "overrideNote" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("sku")
);

-- CreateIndex
CREATE INDEX "Product_needsHumanReview_revenueImpact_idx" ON "Product"("needsHumanReview", "revenueImpact");

-- CreateIndex
CREATE INDEX "Product_baseChemical_idx" ON "Product"("baseChemical");

-- CreateIndex
CREATE INDEX "Product_reviewStatus_idx" ON "Product"("reviewStatus");
