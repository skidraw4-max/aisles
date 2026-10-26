-- I-058: screen audit (화면 심사) schema. PII-free metadata only; screenshots are referenced by private storage key.
-- CreateEnum
CREATE TYPE "JuryAuditStatus" AS ENUM ('PASS', 'FAIL', 'PARTIAL', 'NOT_TESTED', 'BLOCKED', 'ERROR');

-- CreateEnum
CREATE TYPE "JuryAuditEvidenceKind" AS ENUM ('SCREENSHOT', 'DOM_METRIC', 'A11Y');

-- AlterTable
ALTER TABLE "JuryReadonlyObservationRun" ADD COLUMN     "auditId" TEXT,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'OBSERVATION',
ADD COLUMN     "viewport" TEXT;

-- CreateTable
CREATE TABLE "JuryVisualAudit" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "parentAuditId" TEXT,
    "consentVersion" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "status" "JuryAuditStatus",
    "viewports" JSONB NOT NULL,
    "aiEnabled" BOOLEAN NOT NULL DEFAULT false,
    "summary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "JuryVisualAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JuryAuditPage" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "label" TEXT,
    "viewport" TEXT NOT NULL,
    "status" "JuryAuditStatus" NOT NULL,
    "httpStatus" INTEGER,
    "metrics" JSONB,
    "capturedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JuryAuditPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JuryAuditEvidence" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "pageId" TEXT,
    "tenantId" TEXT NOT NULL,
    "kind" "JuryAuditEvidenceKind" NOT NULL,
    "storageKey" TEXT,
    "sha256" TEXT,
    "masked" BOOLEAN NOT NULL DEFAULT false,
    "byteSize" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "data" JSONB,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JuryAuditEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JuryAuditTestCase" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "viewport" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JuryAuditTestCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JuryAuditTestResult" (
    "id" TEXT NOT NULL,
    "testCaseId" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "status" "JuryAuditStatus" NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JuryAuditTestResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JuryAuditFinding" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "pageId" TEXT,
    "tenantId" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "rule" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'RULE',
    "severity" TEXT NOT NULL,
    "status" "JuryAuditStatus" NOT NULL,
    "viewport" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "evidenceIds" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JuryAuditFinding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JuryVisualAudit_tenantId_idx" ON "JuryVisualAudit"("tenantId");

-- CreateIndex
CREATE INDEX "JuryVisualAudit_connectionId_createdAt_idx" ON "JuryVisualAudit"("connectionId", "createdAt");

-- CreateIndex
CREATE INDEX "JuryVisualAudit_parentAuditId_idx" ON "JuryVisualAudit"("parentAuditId");

-- CreateIndex
CREATE INDEX "JuryAuditPage_auditId_idx" ON "JuryAuditPage"("auditId");

-- CreateIndex
CREATE INDEX "JuryAuditPage_tenantId_idx" ON "JuryAuditPage"("tenantId");

-- CreateIndex
CREATE INDEX "JuryAuditEvidence_auditId_idx" ON "JuryAuditEvidence"("auditId");

-- CreateIndex
CREATE INDEX "JuryAuditEvidence_tenantId_idx" ON "JuryAuditEvidence"("tenantId");

-- CreateIndex
CREATE INDEX "JuryAuditEvidence_expiresAt_idx" ON "JuryAuditEvidence"("expiresAt");

-- CreateIndex
CREATE INDEX "JuryAuditTestCase_tenantId_idx" ON "JuryAuditTestCase"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "JuryAuditTestCase_auditId_key_viewport_key" ON "JuryAuditTestCase"("auditId", "key", "viewport");

-- CreateIndex
CREATE INDEX "JuryAuditTestResult_testCaseId_idx" ON "JuryAuditTestResult"("testCaseId");

-- CreateIndex
CREATE INDEX "JuryAuditTestResult_auditId_idx" ON "JuryAuditTestResult"("auditId");

-- CreateIndex
CREATE INDEX "JuryAuditTestResult_tenantId_idx" ON "JuryAuditTestResult"("tenantId");

-- CreateIndex
CREATE INDEX "JuryAuditFinding_auditId_idx" ON "JuryAuditFinding"("auditId");

-- CreateIndex
CREATE INDEX "JuryAuditFinding_pageId_idx" ON "JuryAuditFinding"("pageId");

-- CreateIndex
CREATE INDEX "JuryAuditFinding_tenantId_idx" ON "JuryAuditFinding"("tenantId");

-- CreateIndex
CREATE INDEX "JuryReadonlyObservationRun_auditId_idx" ON "JuryReadonlyObservationRun"("auditId");

-- AddForeignKey
ALTER TABLE "JuryVisualAudit" ADD CONSTRAINT "JuryVisualAudit_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "JuryTenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JuryVisualAudit" ADD CONSTRAINT "JuryVisualAudit_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "JuryServiceConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JuryVisualAudit" ADD CONSTRAINT "JuryVisualAudit_parentAuditId_fkey" FOREIGN KEY ("parentAuditId") REFERENCES "JuryVisualAudit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JuryAuditPage" ADD CONSTRAINT "JuryAuditPage_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "JuryVisualAudit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JuryAuditEvidence" ADD CONSTRAINT "JuryAuditEvidence_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "JuryVisualAudit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JuryAuditEvidence" ADD CONSTRAINT "JuryAuditEvidence_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "JuryAuditPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JuryAuditTestCase" ADD CONSTRAINT "JuryAuditTestCase_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "JuryVisualAudit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JuryAuditTestResult" ADD CONSTRAINT "JuryAuditTestResult_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "JuryAuditTestCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JuryAuditFinding" ADD CONSTRAINT "JuryAuditFinding_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "JuryVisualAudit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JuryAuditFinding" ADD CONSTRAINT "JuryAuditFinding_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "JuryAuditPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "JuryVisualAudit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "JuryAuditPage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "JuryAuditEvidence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "JuryAuditTestCase" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "JuryAuditTestResult" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "JuryAuditFinding" ENABLE ROW LEVEL SECURITY;
