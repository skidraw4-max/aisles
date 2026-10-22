-- Product evidence identity and privacy flags.
-- Designed for a later approval. Do not apply this file until that approval.
-- JuryEvidence is expected to be empty. Defaults are removed so later inserts must send the flags.

ALTER TABLE "JuryEvidence" ADD COLUMN "piiExcluded" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "JuryEvidence" ADD COLUMN "readOnly" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "JuryEvidence" ALTER COLUMN "piiExcluded" DROP DEFAULT;
ALTER TABLE "JuryEvidence" ALTER COLUMN "readOnly" DROP DEFAULT;

CREATE UNIQUE INDEX "JuryEvidence_identity_key"
ON "JuryEvidence" ("tenantId", "connectionId", purpose, "periodStart", "periodEnd", timezone, "contentHash");
