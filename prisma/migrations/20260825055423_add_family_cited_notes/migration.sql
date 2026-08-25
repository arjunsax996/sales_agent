-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "familyCitedNotes" TEXT[] DEFAULT ARRAY[]::TEXT[];
