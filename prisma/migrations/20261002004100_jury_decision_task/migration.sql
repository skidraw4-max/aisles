-- Decision tasks sit beside the agent-loop JuryImprovementTask.
CREATE TYPE "JuryDecisionTaskType" AS ENUM ('VERIFICATION', 'REWORD');

CREATE TYPE "JuryDecisionTaskStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'CANCELLED');

CREATE TABLE "JuryDecisionTask" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reviewResultId" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "taskType" "JuryDecisionTaskType" NOT NULL,
    "decision" "JuryDecision" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "JuryDecisionTaskStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JuryDecisionTask_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "JuryDecisionTask_reviewResultId_taskType_key" ON "JuryDecisionTask"("reviewResultId", "taskType");

CREATE INDEX "JuryDecisionTask_tenantId_idx" ON "JuryDecisionTask"("tenantId");

ALTER TABLE "JuryDecisionTask" ADD CONSTRAINT "JuryDecisionTask_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "JuryTenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "JuryDecisionTask" ADD CONSTRAINT "JuryDecisionTask_reviewResultId_fkey" FOREIGN KEY ("reviewResultId") REFERENCES "JuryReviewResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "JuryDecisionTask" ADD CONSTRAINT "JuryDecisionTask_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "JuryEvidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "JuryDecisionTask" ENABLE ROW LEVEL SECURITY;
