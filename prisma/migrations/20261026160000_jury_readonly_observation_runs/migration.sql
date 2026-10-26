-- I-047: PII-free READ_ONLY_ACCOUNT observation run summaries.
-- CreateTable
CREATE TABLE "JuryReadonlyObservationRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "stop" TEXT,
    "challenge" TEXT,
    "loginAttempts" INTEGER NOT NULL,
    "pagesObserved" INTEGER NOT NULL,
    "pagesVisible" INTEGER NOT NULL,
    "pages" JSONB NOT NULL,
    "blockedRequestCount" INTEGER NOT NULL,
    "blockedByReason" JSONB NOT NULL,
    "finalOrigin" TEXT,
    "finalPath" TEXT,
    "observedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JuryReadonlyObservationRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JuryReadonlyObservationRun_tenantId_idx" ON "JuryReadonlyObservationRun"("tenantId");

-- CreateIndex
CREATE INDEX "JuryReadonlyObservationRun_connectionId_observedAt_idx" ON "JuryReadonlyObservationRun"("connectionId", "observedAt");

-- AddForeignKey
ALTER TABLE "JuryReadonlyObservationRun" ADD CONSTRAINT "JuryReadonlyObservationRun_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "JuryTenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JuryReadonlyObservationRun" ADD CONSTRAINT "JuryReadonlyObservationRun_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "JuryServiceConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "JuryReadonlyObservationRun" ENABLE ROW LEVEL SECURITY;
