-- CreateEnum
CREATE TYPE "BatchJobState" AS ENUM ('RUNNING', 'DONE', 'ERROR');

-- CreateTable
CREATE TABLE "BatchJob" (
    "id" TEXT NOT NULL,
    "state" "BatchJobState" NOT NULL DEFAULT 'RUNNING',
    "totalFamilies" INTEGER NOT NULL,
    "familiesDone" INTEGER NOT NULL DEFAULT 0,
    "familiesFailed" INTEGER NOT NULL DEFAULT 0,
    "currentFamily" TEXT,
    "message" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "BatchJob_pkey" PRIMARY KEY ("id")
);
