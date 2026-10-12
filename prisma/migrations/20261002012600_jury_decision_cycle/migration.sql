-- Product loop policy and one decision cycle per root review.
CREATE TYPE "JuryDecisionCycleStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'BLOCKED', 'FAILED', 'CANCELLED');

CREATE TABLE "JuryProductLoopPolicy" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "maxIterations" INTEGER,
    "maxVerificationAttempts" INTEGER,
    "maxSameDecision" INTEGER,
    "maxSameConflict" INTEGER,
    "maxRuntimeMs" INTEGER,
    "maxCostUsd" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JuryProductLoopPolicy_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "JuryProductLoopPolicy_tenantId_key" ON "JuryProductLoopPolicy"("tenantId");

CREATE TABLE "JuryDecisionCycle" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "rootReviewResultId" TEXT NOT NULL,
    "currentReviewResultId" TEXT NOT NULL,
    "policyId" TEXT,
    "iteration" INTEGER NOT NULL,
    "verificationAttempts" INTEGER NOT NULL,
    "sameDecisionCount" INTEGER NOT NULL,
    "sameConflictCount" INTEGER NOT NULL,
    "decisionFingerprint" TEXT NOT NULL,
    "conflictFingerprint" TEXT NOT NULL,
    "status" "JuryDecisionCycleStatus" NOT NULL,
    "blockedReason" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JuryDecisionCycle_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "JuryDecisionCycle_rootReviewResultId_key" ON "JuryDecisionCycle"("rootReviewResultId");

CREATE INDEX "JuryDecisionCycle_tenantId_idx" ON "JuryDecisionCycle"("tenantId");

ALTER TABLE "JuryProductLoopPolicy" ADD CONSTRAINT "JuryProductLoopPolicy_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "JuryTenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "JuryDecisionCycle" ADD CONSTRAINT "JuryDecisionCycle_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "JuryTenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "JuryDecisionCycle" ADD CONSTRAINT "JuryDecisionCycle_rootReviewResultId_fkey" FOREIGN KEY ("rootReviewResultId") REFERENCES "JuryReviewResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "JuryDecisionCycle" ADD CONSTRAINT "JuryDecisionCycle_currentReviewResultId_fkey" FOREIGN KEY ("currentReviewResultId") REFERENCES "JuryReviewResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "JuryDecisionCycle" ADD CONSTRAINT "JuryDecisionCycle_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "JuryProductLoopPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "JuryProductLoopPolicy" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "JuryDecisionCycle" ENABLE ROW LEVEL SECURITY;
