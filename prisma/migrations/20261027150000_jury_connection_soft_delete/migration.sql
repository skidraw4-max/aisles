-- I-079: connection soft delete metadata (additive, nullable, idempotent).
ALTER TABLE "JuryServiceConnection" ADD COLUMN IF NOT EXISTS "disconnectedAt" TIMESTAMP(3);
ALTER TABLE "JuryServiceConnection" ADD COLUMN IF NOT EXISTS "disconnectedByUserId" TEXT;
