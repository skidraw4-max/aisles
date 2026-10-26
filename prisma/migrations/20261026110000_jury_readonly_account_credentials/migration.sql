-- I-039/I-040 PROPOSAL ONLY. Not applied to any database. Production apply requires JD's separate approval.
-- CreateTable
CREATE TABLE "JuryAccountCredential" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL,
    "ciphertext" TEXT,
    "iv" TEXT,
    "authTag" TEXT,
    "wrappedDek" TEXT,
    "kekId" TEXT NOT NULL,
    "usernameHint" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "destroyedAt" TIMESTAMP(3),
    "destroyReason" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JuryAccountCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JuryConnectionConsent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "scopeHash" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JuryConnectionConsent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JuryAccountCredential_tenantId_idx" ON "JuryAccountCredential"("tenantId");

-- CreateIndex
CREATE INDEX "JuryAccountCredential_connectionId_idx" ON "JuryAccountCredential"("connectionId");

-- CreateIndex
CREATE INDEX "JuryAccountCredential_expiresAt_idx" ON "JuryAccountCredential"("expiresAt");

-- CreateIndex
CREATE INDEX "JuryConnectionConsent_tenantId_idx" ON "JuryConnectionConsent"("tenantId");

-- CreateIndex
CREATE INDEX "JuryConnectionConsent_connectionId_idx" ON "JuryConnectionConsent"("connectionId");

-- AddForeignKey
ALTER TABLE "JuryAccountCredential" ADD CONSTRAINT "JuryAccountCredential_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "JuryTenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JuryAccountCredential" ADD CONSTRAINT "JuryAccountCredential_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "JuryServiceConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JuryConnectionConsent" ADD CONSTRAINT "JuryConnectionConsent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "JuryTenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JuryConnectionConsent" ADD CONSTRAINT "JuryConnectionConsent_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "JuryServiceConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "JuryAccountCredential" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "JuryConnectionConsent" ENABLE ROW LEVEL SECURITY;
