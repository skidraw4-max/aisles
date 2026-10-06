-- Records an explicit decision for a GATED change-gate result.
CREATE TYPE "JuryChangeGateResolutionAction" AS ENUM ('RECHECK_REQUIRED', 'MANUAL_APPROVE', 'MANUAL_BLOCK');

CREATE TABLE "JuryChangeGateResolution" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "changeGateResultId" TEXT NOT NULL,
    "agentExecutionId" TEXT NOT NULL,
    "improvementTaskId" TEXT NOT NULL,
    "action" "JuryChangeGateResolutionAction" NOT NULL,
    "previousStatus" "JuryChangeGateStatus" NOT NULL,
    "resultingStatus" "JuryChangeGateStatus" NOT NULL,
    "reason" JSONB NOT NULL,
    "reasonFingerprint" TEXT NOT NULL,
    "resolvedBy" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3) NOT NULL,
    "provenance" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JuryChangeGateResolution_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "JuryChangeGateResolution_gate_action_reason_key" ON "JuryChangeGateResolution"("changeGateResultId", "action", "reasonFingerprint");
CREATE INDEX "JuryChangeGateResolution_tenantId_idx" ON "JuryChangeGateResolution"("tenantId");

ALTER TABLE "JuryChangeGateResolution" ADD CONSTRAINT "JuryChangeGateResolution_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "JuryTenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JuryChangeGateResolution" ADD CONSTRAINT "JuryChangeGateResolution_changeGateResultId_fkey" FOREIGN KEY ("changeGateResultId") REFERENCES "JuryChangeGateResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "JuryChangeGateResolution" ENABLE ROW LEVEL SECURITY;
