-- Phase 80-2. Created only. Do not apply in this phase.
CREATE TYPE "JuryMemberRole_new" AS ENUM ('OWNER', 'ADMIN', 'REVIEWER', 'DEVELOPER', 'VIEWER');

ALTER TABLE "JuryMembership" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "JuryMembership" ALTER COLUMN "role" TYPE "JuryMemberRole_new" USING (
  CASE "role"::text
    WHEN 'OWNER' THEN 'OWNER'
    WHEN 'MEMBER' THEN 'DEVELOPER'
    WHEN 'AUDITOR' THEN 'VIEWER'
    ELSE 'VIEWER'
  END
)::"JuryMemberRole_new";

DROP TYPE "JuryMemberRole";
ALTER TYPE "JuryMemberRole_new" RENAME TO "JuryMemberRole";

DROP INDEX IF EXISTS "JuryMembership_userId_key";
CREATE UNIQUE INDEX "JuryMembership_tenantId_userId_key" ON "JuryMembership"("tenantId", "userId");
CREATE INDEX IF NOT EXISTS "JuryMembership_userId_idx" ON "JuryMembership"("userId");

CREATE TYPE "JuryServicePermission" AS ENUM ('VIEW', 'REVIEW', 'IMPROVE', 'AGENT');

CREATE TABLE "JuryServiceMember" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "permission" "JuryServicePermission" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "JuryServiceMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "JuryServiceMember_connectionId_userId_permission_key" ON "JuryServiceMember"("connectionId", "userId", "permission");
CREATE INDEX "JuryServiceMember_tenantId_idx" ON "JuryServiceMember"("tenantId");
CREATE INDEX "JuryServiceMember_userId_idx" ON "JuryServiceMember"("userId");

ALTER TABLE "JuryServiceMember" ADD CONSTRAINT "JuryServiceMember_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "JuryTenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JuryServiceMember" ADD CONSTRAINT "JuryServiceMember_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "JuryServiceConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JuryServiceMember" ADD CONSTRAINT "JuryServiceMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "OrganizationInvitation" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "role" "JuryMemberRole" NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "invitedBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OrganizationInvitation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrganizationInvitation_tokenHash_key" ON "OrganizationInvitation"("tokenHash");
CREATE INDEX "OrganizationInvitation_tenantId_email_idx" ON "OrganizationInvitation"("tenantId", "email");

ALTER TABLE "OrganizationInvitation" ADD CONSTRAINT "OrganizationInvitation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "JuryTenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrganizationInvitation" ADD CONSTRAINT "OrganizationInvitation_invitedBy_fkey" FOREIGN KEY ("invitedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "JuryServiceMember" ("id", "tenantId", "connectionId", "userId", "permission", "createdAt")
SELECT md5(m."id" || ':' || c."id" || ':' || p."permission"), m."tenantId", c."id", m."userId", p."permission"::"JuryServicePermission", CURRENT_TIMESTAMP
FROM "JuryMembership" m
JOIN "JuryServiceConnection" c ON c."tenantId" = m."tenantId"
JOIN (
  SELECT 'VIEW' AS "permission"
  UNION ALL SELECT 'REVIEW'
  UNION ALL SELECT 'IMPROVE'
  UNION ALL SELECT 'AGENT'
) p ON (
  m."role"::text IN ('OWNER', 'DEVELOPER')
  OR (m."role"::text = 'VIEWER' AND p."permission" = 'VIEW')
);

ALTER TABLE "JuryServiceMember" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrganizationInvitation" ENABLE ROW LEVEL SECURITY;
