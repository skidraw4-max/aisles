-- RM-10b backfill, SQL equivalent of backfill-rm10b.ts (--apply). NOT approved for production until JD says so.
-- 1) OWNER/creator service grants (planOwnerGrants): for every connection, tenant memberships with role OWNER,
--    or the connection creator, get migratedServicePermissions(role); id 'rm10b:<conn>:<user>:<perm>', ON CONFLICT DO NOTHING.
-- 2) DISCOVERY_PENDING -> CONNECTED when the connection has >=1 APPROVED scope (activatePendingConnection), plus an
--    audit row with the app's deterministic id sha256(tenantId\nSERVICE_CONNECTION_ACTIVATED\nconnectionId).
-- Single transaction, lock_timeout 5s, idempotent (second run: 0 / 0 / 0).
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

WITH planned AS (
  SELECT DISTINCT c."tenantId", c.id AS "connectionId", m."userId", p.perm
  FROM "JuryServiceConnection" c
  JOIN "JuryMembership" m ON m."tenantId" = c."tenantId"
  CROSS JOIN LATERAL unnest(CASE WHEN m.role::text IN ('OWNER','ADMIN','DEVELOPER') THEN ARRAY['VIEW','REVIEW','IMPROVE','AGENT']
                                 WHEN m.role::text = 'REVIEWER' THEN ARRAY['VIEW','REVIEW'] ELSE ARRAY['VIEW'] END) AS p(perm)
  WHERE m.role::text IN ('OWNER','ADMIN','REVIEWER','DEVELOPER','VIEWER')
    AND (m.role::text = 'OWNER' OR m."userId" = c."createdByUserId")
)
INSERT INTO "JuryServiceMember" (id, "tenantId", "connectionId", "userId", permission)
SELECT 'rm10b:' || "connectionId" || ':' || "userId" || ':' || perm, "tenantId", "connectionId", "userId", perm::"JuryServicePermission"
FROM planned pl
WHERE NOT EXISTS (SELECT 1 FROM "JuryServiceMember" s WHERE s."connectionId" = pl."connectionId" AND s."userId" = pl."userId" AND s.permission::text = pl.perm)
ON CONFLICT DO NOTHING;

WITH act AS (
  UPDATE "JuryServiceConnection" c SET status = 'CONNECTED', "updatedAt" = now()
  WHERE c.status = 'DISCOVERY_PENDING'
    AND EXISTS (SELECT 1 FROM "JuryAccessScope" s WHERE s."connectionId" = c.id AND s."tenantId" = c."tenantId" AND s.status::text = 'APPROVED')
  RETURNING c.id, c."tenantId", c."serviceKey", c."accessMethod"
)
INSERT INTO "JuryAuditEvent" (id, "tenantId", timestamp, actor, action, "serviceKey", "accessMethod")
SELECT encode(sha256(convert_to(a."tenantId" || E'\n' || 'SERVICE_CONNECTION_ACTIVATED' || E'\n' || a.id, 'UTF8')), 'hex'),
       a."tenantId", now(), 'system:backfill-rm10b', 'SERVICE_CONNECTION_ACTIVATED', a."serviceKey", a."accessMethod"::text
FROM act a
ON CONFLICT (id) DO NOTHING;
COMMIT;
