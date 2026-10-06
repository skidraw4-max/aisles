-- Re-review execution links a new review result to the parent without rewriting it.
ALTER TYPE "JuryVerificationReviewStatus" ADD VALUE 'RUNNING';
ALTER TYPE "JuryVerificationReviewStatus" ADD VALUE 'FAILED';

ALTER TABLE "JuryReviewResult" ADD COLUMN "parentReviewResultId" TEXT;
ALTER TABLE "JuryReviewResult" ADD COLUMN "verificationResultId" TEXT;
ALTER TABLE "JuryReviewResult" ADD COLUMN "decisionTaskId" TEXT;
ALTER TABLE "JuryReviewResult" ADD COLUMN "reReviewRequestId" TEXT;

CREATE UNIQUE INDEX "JuryReviewResult_reReviewRequestId_key" ON "JuryReviewResult"("reReviewRequestId");

ALTER TABLE "JuryReviewResult" ADD CONSTRAINT "JuryReviewResult_parentReviewResultId_fkey" FOREIGN KEY ("parentReviewResultId") REFERENCES "JuryReviewResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "JuryReviewResult" ADD CONSTRAINT "JuryReviewResult_verificationResultId_fkey" FOREIGN KEY ("verificationResultId") REFERENCES "JuryVerificationResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "JuryReviewResult" ADD CONSTRAINT "JuryReviewResult_decisionTaskId_fkey" FOREIGN KEY ("decisionTaskId") REFERENCES "JuryDecisionTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "JuryReviewResult" ADD CONSTRAINT "JuryReviewResult_reReviewRequestId_fkey" FOREIGN KEY ("reReviewRequestId") REFERENCES "JuryVerificationReview"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
