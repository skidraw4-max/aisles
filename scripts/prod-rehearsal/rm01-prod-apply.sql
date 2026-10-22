-- RM-01 production apply (runbook step 4). Single transaction, lock_timeout 5s. Migration body is byte-identical to prisma/migrations/20261022130000_jury_review_tracking_rm01/migration.sql (sha256 2d185302…348d).
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
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

INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, started_at, applied_steps_count) SELECT gen_random_uuid()::text, '2d18530222aba279d25ee35c579e78b43b6c9d2b16cf7d8de273e63bb9b8348d', now(), '20261022130000_jury_review_tracking_rm01', now(), 1 WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20261022130000_jury_review_tracking_rm01' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
COMMIT;
