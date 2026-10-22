-- Re-review request after an APPROVED change gate. Separate from verification re-review.
CREATE TYPE "JuryChangeGateReviewStatus" AS ENUM ('READY', 'RUNNING', 'EXECUTED', 'FAILED');
CREATE TYPE "JuryChangeGateReviewSource" AS ENUM ('CHANGE_GATE');

CREATE TABLE "JuryChangeGateReview" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "parentReviewResultId" TEXT NOT NULL,
    "changeGateResultId" TEXT NOT NULL,
    "agentExecutionId" TEXT NOT NULL,
    "improvementTaskId" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "sourceEvidenceId" TEXT NOT NULL,
    "reason" JSONB NOT NULL,
    "status" "JuryChangeGateReviewStatus" NOT NULL,
    "source" "JuryChangeGateReviewSource" NOT NULL,
    "errorCode" TEXT,
    "reviewRequestId" TEXT,
    "reviewResultId" TEXT,
    "provenance" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JuryChangeGateReview_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "JuryChangeGateReview_changeGateResultId_key" ON "JuryChangeGateReview"("changeGateResultId");
CREATE UNIQUE INDEX "JuryChangeGateReview_reviewRequestId_key" ON "JuryChangeGateReview"("reviewRequestId");
CREATE INDEX "JuryChangeGateReview_tenantId_idx" ON "JuryChangeGateReview"("tenantId");

ALTER TABLE "JuryChangeGateReview" ADD CONSTRAINT "JuryChangeGateReview_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "JuryTenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JuryChangeGateReview" ADD CONSTRAINT "JuryChangeGateReview_parentReviewResultId_fkey" FOREIGN KEY ("parentReviewResultId") REFERENCES "JuryReviewResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "JuryChangeGateReview" ADD CONSTRAINT "JuryChangeGateReview_changeGateResultId_fkey" FOREIGN KEY ("changeGateResultId") REFERENCES "JuryChangeGateResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "JuryChangeGateReview" ADD CONSTRAINT "JuryChangeGateReview_improvementTaskId_fkey" FOREIGN KEY ("improvementTaskId") REFERENCES "JuryImprovementTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "JuryChangeGateReview" ADD CONSTRAINT "JuryChangeGateReview_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "JuryEvidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "JuryChangeGateReview" ENABLE ROW LEVEL SECURITY;
