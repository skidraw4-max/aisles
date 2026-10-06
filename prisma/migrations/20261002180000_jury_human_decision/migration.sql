-- One stored human choice per review. It does not replace JuryReviewResult.expectedDecision.
CREATE TABLE "JuryHumanDecision" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reviewResultId" TEXT NOT NULL,
    "reviewRequestId" TEXT NOT NULL,
    "decision" "JuryDecision" NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JuryHumanDecision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "JuryHumanDecision_reviewResultId_key" ON "JuryHumanDecision"("reviewResultId");

CREATE UNIQUE INDEX "JuryHumanDecision_reviewRequestId_key" ON "JuryHumanDecision"("reviewRequestId");

CREATE UNIQUE INDEX "JuryHumanDecision_tenant_review_key" ON "JuryHumanDecision"("tenantId", "reviewResultId");

CREATE INDEX "JuryHumanDecision_tenantId_idx" ON "JuryHumanDecision"("tenantId");

ALTER TABLE "JuryHumanDecision" ADD CONSTRAINT "JuryHumanDecision_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "JuryTenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "JuryHumanDecision" ADD CONSTRAINT "JuryHumanDecision_reviewResultId_fkey" FOREIGN KEY ("reviewResultId") REFERENCES "JuryReviewResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "JuryHumanDecision" ADD CONSTRAINT "JuryHumanDecision_reviewRequestId_fkey" FOREIGN KEY ("reviewRequestId") REFERENCES "JuryReviewRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "JuryHumanDecision" ENABLE ROW LEVEL SECURITY;
