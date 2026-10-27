-- I-072 (Phase 1): ownership verification (DNS TXT / meta tag / well-known file) and per-connection provider config.
-- Additive only: one nullable column, two new enums, one new table. No existing row is changed.
-- Tokens are stored as HMAC hashes only (tokenHash) plus a 4-char hint; plaintext tokens are never stored.

-- AlterTable
ALTER TABLE "JuryServiceConnection" ADD COLUMN "providerConfig" JSONB;

-- CreateEnum
CREATE TYPE "JuryOwnershipMethod" AS ENUM ('DNS_TXT', 'META_TAG', 'WELL_KNOWN_FILE');

-- CreateEnum
CREATE TYPE "JuryOwnershipStatus" AS ENUM ('PENDING', 'VERIFIED', 'FAILED', 'EXPIRED', 'REVOKED');

-- CreateTable
CREATE TABLE "JuryOwnershipVerification" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "method" "JuryOwnershipMethod" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenHint" TEXT NOT NULL,
    "status" "JuryOwnershipStatus" NOT NULL DEFAULT 'PENDING',
    "verifiedAt" TIMESTAMP(3),
    "lastCheckedAt" TIMESTAMP(3),
    "nextCheckAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "lastFailureCode" TEXT,
    "createdByUserId" TEXT,
    "consentVersion" TEXT NOT NULL,
    "consentAcceptedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JuryOwnershipVerification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "JuryOwnershipVerification_tenantId_connectionId_host_key" ON "JuryOwnershipVerification"("tenantId", "connectionId", "host");

-- CreateIndex
CREATE INDEX "JuryOwnershipVerification_tenantId_idx" ON "JuryOwnershipVerification"("tenantId");

-- CreateIndex
CREATE INDEX "JuryOwnershipVerification_connectionId_idx" ON "JuryOwnershipVerification"("connectionId");

-- CreateIndex
CREATE INDEX "JuryOwnershipVerification_status_nextCheckAt_idx" ON "JuryOwnershipVerification"("status", "nextCheckAt");

-- AddForeignKey
ALTER TABLE "JuryOwnershipVerification" ADD CONSTRAINT "JuryOwnershipVerification_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "JuryTenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JuryOwnershipVerification" ADD CONSTRAINT "JuryOwnershipVerification_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "JuryServiceConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "JuryOwnershipVerification" ENABLE ROW LEVEL SECURITY;
