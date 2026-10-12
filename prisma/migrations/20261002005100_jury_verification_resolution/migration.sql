-- Verification results and the re-review request that stops at READY.
CREATE TYPE "JuryVerificationStatus" AS ENUM ('RESOLVED', 'UNRESOLVED', 'INCONCLUSIVE');

CREATE TYPE "JuryVerificationReviewStatus" AS ENUM ('PENDING', 'READY', 'EXECUTED', 'BLOCKED');

CREATE TYPE "JuryVerificationReviewType" AS ENUM ('VERIFICATION_REREVIEW');

CREATE TABLE "JuryVerificationResult" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "decisionTaskId" TEXT NOT NULL,
    "reviewResultId" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "status" "JuryVerificationStatus" NOT NULL,
    "finding" TEXT NOT NULL,
    "verificationGoal" TEXT NOT NULL,
    "provenance" JSONB NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JuryVerificationResult_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "JuryVerificationResult_decisionTaskId_key" ON "JuryVerificationResult"("decisionTaskId");

CREATE INDEX "JuryVerificationResult_tenantId_idx" ON "JuryVerificationResult"("tenantId");

CREATE TABLE "JuryVerificationReview" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "parentReviewResultId" TEXT NOT NULL,
    "verificationResultId" TEXT NOT NULL,
    "decisionTaskId" TEXT NOT NULL,
    "type" "JuryVerificationReviewType" NOT NULL,
    "status" "JuryVerificationReviewStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JuryVerificationReview_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "JuryVerificationReview_verificationResultId_key" ON "JuryVerificationReview"("verificationResultId");

CREATE INDEX "JuryVerificationReview_tenantId_idx" ON "JuryVerificationReview"("tenantId");

ALTER TABLE "JuryVerificationResult" ADD CONSTRAINT "JuryVerificationResult_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "JuryTenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "JuryVerificationResult" ADD CONSTRAINT "JuryVerificationResult_decisionTaskId_fkey" FOREIGN KEY ("decisionTaskId") REFERENCES "JuryDecisionTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "JuryVerificationResult" ADD CONSTRAINT "JuryVerificationResult_reviewResultId_fkey" FOREIGN KEY ("reviewResultId") REFERENCES "JuryReviewResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "JuryVerificationResult" ADD CONSTRAINT "JuryVerificationResult_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "JuryEvidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "JuryVerificationReview" ADD CONSTRAINT "JuryVerificationReview_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "JuryTenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "JuryVerificationReview" ADD CONSTRAINT "JuryVerificationReview_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "JuryEvidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "JuryVerificationReview" ADD CONSTRAINT "JuryVerificationReview_parentReviewResultId_fkey" FOREIGN KEY ("parentReviewResultId") REFERENCES "JuryReviewResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "JuryVerificationReview" ADD CONSTRAINT "JuryVerificationReview_verificationResultId_fkey" FOREIGN KEY ("verificationResultId") REFERENCES "JuryVerificationResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "JuryVerificationReview" ADD CONSTRAINT "JuryVerificationReview_decisionTaskId_fkey" FOREIGN KEY ("decisionTaskId") REFERENCES "JuryDecisionTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "JuryVerificationResult" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "JuryVerificationReview" ENABLE ROW LEVEL SECURITY;
