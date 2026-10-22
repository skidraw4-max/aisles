-- CreateEnum
CREATE TYPE "JuryResultSource" AS ENUM ('REAL_MODEL', 'MOCK', 'FIXTURE', 'UNKNOWN_LEGACY', 'VERIFIED_REAL');

-- AlterTable
ALTER TABLE "JuryReviewRequest" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "failureReason" TEXT,
ADD COLUMN     "resultSource" "JuryResultSource" NOT NULL DEFAULT 'UNKNOWN_LEGACY',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "JuryReviewAttempt" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reviewRequestKey" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "reviewType" "JuryReviewType" NOT NULL,
    "status" "JuryReviewStatus" NOT NULL,
    "failureReason" TEXT,
    "resultSource" "JuryResultSource" NOT NULL DEFAULT 'UNKNOWN_LEGACY',
    "boardRunId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JuryReviewAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JuryLlmCallLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "operation" TEXT NOT NULL,
    "memberId" TEXT,
    "status" TEXT NOT NULL,
    "errorCode" TEXT,
    "latencyMs" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JuryLlmCallLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JuryReviewAttempt_tenantId_reviewRequestKey_idx" ON "JuryReviewAttempt"("tenantId", "reviewRequestKey");

-- CreateIndex
CREATE INDEX "JuryReviewAttempt_status_startedAt_idx" ON "JuryReviewAttempt"("status", "startedAt");

-- CreateIndex
CREATE INDEX "JuryLlmCallLog_tenantId_idx" ON "JuryLlmCallLog"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "JuryLlmCallLog_attemptId_seq_key" ON "JuryLlmCallLog"("attemptId", "seq");

-- AddForeignKey
ALTER TABLE "JuryReviewAttempt" ADD CONSTRAINT "JuryReviewAttempt_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "JuryTenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JuryLlmCallLog" ADD CONSTRAINT "JuryLlmCallLog_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "JuryReviewAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RM-01: keep parity with existing Jury tables (RLS on, no policies; server access via Prisma only).
ALTER TABLE "JuryReviewAttempt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "JuryLlmCallLog" ENABLE ROW LEVEL SECURITY;
