-- Auto Loop on/off. Separate from JuryProductLoopPolicy numeric limits.
CREATE TABLE "JuryAutoLoopActivation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT NOT NULL,

    CONSTRAINT "JuryAutoLoopActivation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "JuryAutoLoopActivation_tenantId_key" ON "JuryAutoLoopActivation"("tenantId");
CREATE INDEX "JuryAutoLoopActivation_tenantId_idx" ON "JuryAutoLoopActivation"("tenantId");

ALTER TABLE "JuryAutoLoopActivation" ADD CONSTRAINT "JuryAutoLoopActivation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "JuryTenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "JuryAutoLoopActivation" ENABLE ROW LEVEL SECURITY;
