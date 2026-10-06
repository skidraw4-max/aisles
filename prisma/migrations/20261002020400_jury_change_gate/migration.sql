-- Change Gate inspection columns. The table already has row level security and no policies.
CREATE TYPE "JuryChangeGateStatus" AS ENUM ('GATED', 'APPROVED', 'BLOCKED');
CREATE TYPE "JuryChangeRiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

ALTER TABLE "JuryChangeGateResult" ADD COLUMN "improvementTaskId" TEXT;
ALTER TABLE "JuryChangeGateResult" ADD COLUMN "status" "JuryChangeGateStatus";
ALTER TABLE "JuryChangeGateResult" ADD COLUMN "addedFiles" JSONB;
ALTER TABLE "JuryChangeGateResult" ADD COLUMN "modifiedFiles" JSONB;
ALTER TABLE "JuryChangeGateResult" ADD COLUMN "deletedFiles" JSONB;
ALTER TABLE "JuryChangeGateResult" ADD COLUMN "blockedFiles" JSONB;
ALTER TABLE "JuryChangeGateResult" ADD COLUMN "riskLevel" "JuryChangeRiskLevel";
ALTER TABLE "JuryChangeGateResult" ADD COLUMN "riskReasons" JSONB;
ALTER TABLE "JuryChangeGateResult" ADD COLUMN "testResults" JSONB;
ALTER TABLE "JuryChangeGateResult" ADD COLUMN "agentReportedFiles" JSONB;
ALTER TABLE "JuryChangeGateResult" ADD COLUMN "discrepancy" BOOLEAN;
ALTER TABLE "JuryChangeGateResult" ADD COLUMN "discrepancyReasons" JSONB;
ALTER TABLE "JuryChangeGateResult" ADD COLUMN "diffStat" JSONB;
ALTER TABLE "JuryChangeGateResult" ADD COLUMN "provenance" JSONB;
ALTER TABLE "JuryChangeGateResult" ADD COLUMN "errorCode" TEXT;
ALTER TABLE "JuryChangeGateResult" ADD COLUMN "credentialDetected" BOOLEAN;
ALTER TABLE "JuryChangeGateResult" ADD COLUMN "credentialType" TEXT;
ALTER TABLE "JuryChangeGateResult" ADD COLUMN "createdAt" TIMESTAMP(3);
ALTER TABLE "JuryChangeGateResult" ADD COLUMN "updatedAt" TIMESTAMP(3);

ALTER TABLE "JuryChangeGateResult" ADD CONSTRAINT "JuryChangeGateResult_improvementTaskId_fkey" FOREIGN KEY ("improvementTaskId") REFERENCES "JuryImprovementTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
