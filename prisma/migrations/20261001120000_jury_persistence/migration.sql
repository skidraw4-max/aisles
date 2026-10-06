-- Jury product tables. User.role is unchanged. credentialRef is not a secret.

CREATE TYPE "JuryMemberRole" AS ENUM ('OWNER', 'MEMBER', 'AUDITOR');
CREATE TYPE "JuryAccessMethod" AS ENUM ('OAUTH', 'API_KEY', 'READ_ONLY_ACCOUNT', 'BROWSER_SESSION', 'FILE_UPLOAD');
CREATE TYPE "JuryConnectionStatus" AS ENUM ('DRAFT', 'CONNECTED', 'DISCOVERY_PENDING', 'LIMITED', 'DISCONNECTED', 'ERROR');
CREATE TYPE "JuryScopeStatus" AS ENUM ('PROPOSED', 'APPROVED', 'REVOKED');
CREATE TYPE "JuryDiscoveryFeasibility" AS ENUM ('AVAILABLE', 'PARTIAL', 'NOT_AVAILABLE');
CREATE TYPE "JuryApproval" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE "JuryMetricUnit" AS ENUM ('COUNT', 'KRW', 'PERCENT', 'DURATION_SEC', 'RATIO', 'OTHER');
CREATE TYPE "JurySourceSystem" AS ENUM ('DATABASE', 'GA4', 'API', 'SCREEN', 'FILE', 'OTHER');
CREATE TYPE "JuryAvailability" AS ENUM ('AVAILABLE', 'NOT_MEASURED', 'NOT_AVAILABLE', 'PERMISSION_DENIED', 'COLLECTION_FAILED', 'UNSUPPORTED');
CREATE TYPE "JuryReviewType" AS ENUM ('CLAIM_VALIDATION', 'FULL_REVIEW', 'UI_UX_REVIEW');
CREATE TYPE "JuryReviewMode" AS ENUM ('AISLE_SELF', 'EXTERNAL_SERVICE');
CREATE TYPE "JuryReviewStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');
CREATE TYPE "JuryEvidenceStrength" AS ENUM ('strong', 'moderate', 'unknown');
CREATE TYPE "JuryClaimStrength" AS ENUM ('weak', 'strong', 'extreme');
CREATE TYPE "JuryDecision" AS ENUM ('ACCEPT', 'VERIFY', 'REWORD');
CREATE TYPE "JuryTaskStatus" AS ENUM ('OPEN', 'HANDED_OFF', 'GATED', 'NEEDS_APPROVAL', 'DONE', 'STOPPED');
CREATE TYPE "JuryAgentKind" AS ENUM ('CURSOR', 'CLAUDE_CODE', 'MANUAL');
CREATE TYPE "JuryExecutionStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'BLOCKED');
CREATE TYPE "JuryGateResult" AS ENUM ('PASS', 'NEEDS_APPROVAL', 'BLOCK');

CREATE TABLE "JuryTenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "JuryTenant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "JuryMembership" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "JuryMemberRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "JuryMembership_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "JuryMembership_userId_key" ON "JuryMembership"("userId");
CREATE INDEX "JuryMembership_tenantId_idx" ON "JuryMembership"("tenantId");

CREATE TABLE "JuryServiceConnection" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "serviceKey" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "accessMethod" "JuryAccessMethod" NOT NULL,
    "status" "JuryConnectionStatus" NOT NULL,
    "credentialRef" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "JuryServiceConnection_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "JuryServiceConnection_tenantId_idx" ON "JuryServiceConnection"("tenantId");

CREATE TABLE "JuryEvidence" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "periodStart" TEXT NOT NULL,
    "periodEnd" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "metricIds" JSONB NOT NULL,
    "apiEvidence" JSONB,
    "uiEvidence" JSONB,
    "documentEvidence" JSONB,
    "adapterKey" TEXT NOT NULL,
    "collectedAt" TIMESTAMP(3) NOT NULL,
    "contentHash" TEXT,
    CONSTRAINT "JuryEvidence_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "JuryEvidence_tenantId_idx" ON "JuryEvidence"("tenantId");

CREATE TABLE "JuryAccessScope" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "status" "JuryScopeStatus" NOT NULL,
    "grants" JSONB NOT NULL,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    CONSTRAINT "JuryAccessScope_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "JuryAccessScope_tenantId_idx" ON "JuryAccessScope"("tenantId");

CREATE TABLE "JuryDiscoveryResult" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "exploredAt" TIMESTAMP(3) NOT NULL,
    "surfaces" JSONB NOT NULL,
    "menus" JSONB NOT NULL,
    "dataSources" JSONB NOT NULL,
    "feasibility" "JuryDiscoveryFeasibility" NOT NULL,
    "proposedMetrics" JSONB NOT NULL,
    "approval" "JuryApproval" NOT NULL,
    "uiNotes" TEXT,
    CONSTRAINT "JuryDiscoveryResult_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "JuryDiscoveryResult_tenantId_idx" ON "JuryDiscoveryResult"("tenantId");

CREATE TABLE "JuryNormalizedMetric" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "evidenceId" TEXT,
    "metric" TEXT NOT NULL,
    "value" DOUBLE PRECISION,
    "unit" "JuryMetricUnit" NOT NULL,
    "periodStart" TEXT NOT NULL,
    "periodEnd" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "sourceSystem" "JurySourceSystem" NOT NULL,
    "sourceRef" TEXT NOT NULL,
    "collectedAt" TIMESTAMP(3) NOT NULL,
    "availability" "JuryAvailability" NOT NULL,
    "rawValueText" TEXT,
    "rawPayloadRef" TEXT NOT NULL,
    "adapterKey" TEXT NOT NULL,
    "adapterVersion" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    CONSTRAINT "JuryNormalizedMetric_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "JuryNormalizedMetric_tenantId_idx" ON "JuryNormalizedMetric"("tenantId");

CREATE TABLE "JuryReviewRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "reviewType" "JuryReviewType" NOT NULL,
    "claim" TEXT,
    "mode" "JuryReviewMode" NOT NULL,
    "status" "JuryReviewStatus" NOT NULL,
    "coreRootDir" TEXT NOT NULL,
    "requestedByUserId" TEXT,
    CONSTRAINT "JuryReviewRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "JuryReviewRequest_tenantId_idx" ON "JuryReviewRequest"("tenantId");

CREATE TABLE "JuryReviewResult" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reviewRequestId" TEXT NOT NULL,
    "boardRunId" TEXT NOT NULL,
    "evidenceStrength" "JuryEvidenceStrength" NOT NULL,
    "claimStrength" "JuryClaimStrength" NOT NULL,
    "conflictDetected" BOOLEAN NOT NULL,
    "overclaimDetected" BOOLEAN NOT NULL,
    "revisionRequired" BOOLEAN NOT NULL,
    "expectedDecision" "JuryDecision" NOT NULL,
    "finalSurface" JSONB NOT NULL,
    "contractVersion" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "JuryReviewResult_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "JuryReviewResult_reviewRequestId_key" ON "JuryReviewResult"("reviewRequestId");
CREATE INDEX "JuryReviewResult_tenantId_idx" ON "JuryReviewResult"("tenantId");

CREATE TABLE "JuryImprovementTask" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reviewResultId" TEXT NOT NULL,
    "diagnosis" TEXT NOT NULL,
    "acceptanceCriteria" JSONB NOT NULL,
    "status" "JuryTaskStatus" NOT NULL,
    "loopIndex" INTEGER NOT NULL,
    "loopPolicy" JSONB NOT NULL,
    "parentTaskId" TEXT,
    "stopReason" TEXT,
    CONSTRAINT "JuryImprovementTask_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "JuryImprovementTask_tenantId_idx" ON "JuryImprovementTask"("tenantId");

CREATE TABLE "JuryAgentExecution" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "agent" "JuryAgentKind" NOT NULL,
    "allowedPaths" JSONB NOT NULL,
    "deniedPaths" JSONB NOT NULL,
    "status" "JuryExecutionStatus" NOT NULL,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "estimatedCostUsd" DOUBLE PRECISION,
    CONSTRAINT "JuryAgentExecution_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "JuryAgentExecution_tenantId_idx" ON "JuryAgentExecution"("tenantId");

CREATE TABLE "JuryChangeGateResult" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "changedFiles" JSONB NOT NULL,
    "riskFlags" JSONB NOT NULL,
    "testsPassed" BOOLEAN,
    "gate" "JuryGateResult" NOT NULL,
    CONSTRAINT "JuryChangeGateResult_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "JuryChangeGateResult_executionId_key" ON "JuryChangeGateResult"("executionId");
CREATE INDEX "JuryChangeGateResult_tenantId_idx" ON "JuryChangeGateResult"("tenantId");

CREATE TABLE "JuryReReviewResult" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "previousReviewResultId" TEXT NOT NULL,
    "nextReviewResultId" TEXT NOT NULL,
    "resolved" BOOLEAN NOT NULL,
    "sameProblem" BOOLEAN NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "JuryReReviewResult_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "JuryReReviewResult_tenantId_idx" ON "JuryReReviewResult"("tenantId");

CREATE TABLE "JuryAuditEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "serviceKey" TEXT,
    "accessMethod" TEXT,
    "scopeId" TEXT,
    "source" TEXT,
    "evidenceId" TEXT,
    "reviewId" TEXT,
    "decision" TEXT,
    "improvementTaskId" TEXT,
    "agent" TEXT,
    "changedFiles" JSONB,
    "testResult" TEXT,
    "reReviewResultId" TEXT,
    CONSTRAINT "JuryAuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "JuryAuditEvent_tenantId_timestamp_idx" ON "JuryAuditEvent"("tenantId", "timestamp");

ALTER TABLE "JuryMembership" ADD CONSTRAINT "JuryMembership_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "JuryTenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JuryMembership" ADD CONSTRAINT "JuryMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "JuryServiceConnection" ADD CONSTRAINT "JuryServiceConnection_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "JuryTenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JuryEvidence" ADD CONSTRAINT "JuryEvidence_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "JuryTenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JuryEvidence" ADD CONSTRAINT "JuryEvidence_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "JuryServiceConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JuryAccessScope" ADD CONSTRAINT "JuryAccessScope_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "JuryTenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JuryAccessScope" ADD CONSTRAINT "JuryAccessScope_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "JuryServiceConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JuryDiscoveryResult" ADD CONSTRAINT "JuryDiscoveryResult_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "JuryTenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JuryDiscoveryResult" ADD CONSTRAINT "JuryDiscoveryResult_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "JuryServiceConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JuryNormalizedMetric" ADD CONSTRAINT "JuryNormalizedMetric_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "JuryTenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JuryNormalizedMetric" ADD CONSTRAINT "JuryNormalizedMetric_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "JuryServiceConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JuryNormalizedMetric" ADD CONSTRAINT "JuryNormalizedMetric_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "JuryEvidence"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "JuryReviewRequest" ADD CONSTRAINT "JuryReviewRequest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "JuryTenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JuryReviewRequest" ADD CONSTRAINT "JuryReviewRequest_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "JuryServiceConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JuryReviewRequest" ADD CONSTRAINT "JuryReviewRequest_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "JuryEvidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "JuryReviewResult" ADD CONSTRAINT "JuryReviewResult_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "JuryTenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JuryReviewResult" ADD CONSTRAINT "JuryReviewResult_reviewRequestId_fkey" FOREIGN KEY ("reviewRequestId") REFERENCES "JuryReviewRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JuryImprovementTask" ADD CONSTRAINT "JuryImprovementTask_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "JuryTenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JuryImprovementTask" ADD CONSTRAINT "JuryImprovementTask_reviewResultId_fkey" FOREIGN KEY ("reviewResultId") REFERENCES "JuryReviewResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JuryAgentExecution" ADD CONSTRAINT "JuryAgentExecution_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "JuryTenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JuryAgentExecution" ADD CONSTRAINT "JuryAgentExecution_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "JuryImprovementTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JuryChangeGateResult" ADD CONSTRAINT "JuryChangeGateResult_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "JuryTenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JuryChangeGateResult" ADD CONSTRAINT "JuryChangeGateResult_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "JuryAgentExecution"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JuryReReviewResult" ADD CONSTRAINT "JuryReReviewResult_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "JuryTenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JuryReReviewResult" ADD CONSTRAINT "JuryReReviewResult_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "JuryImprovementTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JuryAuditEvent" ADD CONSTRAINT "JuryAuditEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "JuryTenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "JuryTenant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "JuryMembership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "JuryServiceConnection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "JuryEvidence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "JuryAccessScope" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "JuryDiscoveryResult" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "JuryNormalizedMetric" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "JuryReviewRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "JuryReviewResult" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "JuryImprovementTask" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "JuryAgentExecution" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "JuryChangeGateResult" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "JuryReReviewResult" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "JuryAuditEvent" ENABLE ROW LEVEL SECURITY;
