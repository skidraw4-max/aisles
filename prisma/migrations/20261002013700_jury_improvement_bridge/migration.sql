-- Link a REWORD decision task to one improvement task. Existing agent-loop columns stay.
ALTER TABLE "JuryImprovementTask" ADD COLUMN "decisionTaskId" TEXT;
ALTER TABLE "JuryImprovementTask" ADD COLUMN "evidenceId" TEXT;
ALTER TABLE "JuryImprovementTask" ADD COLUMN "taskType" "JuryDecisionTaskType";
ALTER TABLE "JuryImprovementTask" ADD COLUMN "title" TEXT;
ALTER TABLE "JuryImprovementTask" ADD COLUMN "description" TEXT;
ALTER TABLE "JuryImprovementTask" ADD COLUMN "reason" TEXT;
ALTER TABLE "JuryImprovementTask" ADD COLUMN "objective" TEXT;
ALTER TABLE "JuryImprovementTask" ADD COLUMN "constraints" JSONB;
ALTER TABLE "JuryImprovementTask" ADD COLUMN "provenance" JSONB;
ALTER TABLE "JuryImprovementTask" ADD COLUMN "createdAt" TIMESTAMP(3);
ALTER TABLE "JuryImprovementTask" ADD COLUMN "updatedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "JuryImprovementTask_decisionTaskId_taskType_key" ON "JuryImprovementTask"("decisionTaskId", "taskType");

ALTER TABLE "JuryImprovementTask" ADD CONSTRAINT "JuryImprovementTask_decisionTaskId_fkey" FOREIGN KEY ("decisionTaskId") REFERENCES "JuryDecisionTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "JuryImprovementTask" ADD CONSTRAINT "JuryImprovementTask_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "JuryEvidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "JuryAuditEvent" ADD COLUMN "decisionTaskId" TEXT;
