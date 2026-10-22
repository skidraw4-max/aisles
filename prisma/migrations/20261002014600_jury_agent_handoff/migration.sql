-- Pending handoff fields on the existing execution row. RLS stays enabled with no policies.
ALTER TYPE "JuryAgentKind" ADD VALUE 'OTHER';

ALTER TABLE "JuryAgentExecution" ADD COLUMN "inputSnapshot" JSONB;
ALTER TABLE "JuryAgentExecution" ADD COLUMN "workspaceRef" JSONB;
ALTER TABLE "JuryAgentExecution" ADD COLUMN "requestedAt" TIMESTAMP(3);
ALTER TABLE "JuryAgentExecution" ADD COLUMN "resultRef" TEXT;
ALTER TABLE "JuryAgentExecution" ADD COLUMN "errorCode" TEXT;
ALTER TABLE "JuryAgentExecution" ADD COLUMN "provenance" JSONB;
ALTER TABLE "JuryAgentExecution" ADD COLUMN "createdAt" TIMESTAMP(3);
ALTER TABLE "JuryAgentExecution" ADD COLUMN "updatedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "JuryAgentExecution_taskId_agent_key" ON "JuryAgentExecution"("taskId", "agent");

ALTER TABLE "JuryAuditEvent" ADD COLUMN "agentExecutionId" TEXT;
ALTER TABLE "JuryAuditEvent" ADD COLUMN "provenance" JSONB;
