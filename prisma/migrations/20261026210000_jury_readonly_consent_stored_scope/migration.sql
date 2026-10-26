-- I-054: store the consented READ_ONLY_ACCOUNT observation scope and login settings (no secrets).
-- Nullable, additive only. Existing consents keep NULL and fall back to re-entry until re-consented.
-- AlterTable
ALTER TABLE "JuryConnectionConsent" ADD COLUMN "scope" JSONB,
ADD COLUMN "loginSettings" JSONB;
