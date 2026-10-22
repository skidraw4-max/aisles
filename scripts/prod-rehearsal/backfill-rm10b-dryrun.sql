-- RM-10b read-only dry-run: counts only (no ids, no PII).
WITH planned AS (
  SELECT DISTINCT c.id AS "connectionId", m."userId", p.perm
  FROM "JuryServiceConnection" c
  JOIN "JuryMembership" m ON m."tenantId" = c."tenantId"
  CROSS JOIN LATERAL unnest(CASE WHEN m.role::text IN ('OWNER','ADMIN','DEVELOPER') THEN ARRAY['VIEW','REVIEW','IMPROVE','AGENT']
                                 WHEN m.role::text = 'REVIEWER' THEN ARRAY['VIEW','REVIEW'] ELSE ARRAY['VIEW'] END) AS p(perm)
  WHERE m.role::text IN ('OWNER','ADMIN','REVIEWER','DEVELOPER','VIEWER')
    AND (m.role::text = 'OWNER' OR m."userId" = c."createdByUserId")
), missing AS (
  SELECT * FROM planned pl WHERE NOT EXISTS (SELECT 1 FROM "JuryServiceMember" s WHERE s."connectionId" = pl."connectionId" AND s."userId" = pl."userId" AND s.permission::text = pl.perm)
)
SELECT
  (SELECT count(*) FROM "JuryServiceConnection") AS connections,
  (SELECT count(*) FROM planned) AS grants_planned,
  (SELECT count(*) FROM missing) AS grants_missing,
  (SELECT count(DISTINCT "connectionId") FROM missing) AS connections_with_missing,
  (SELECT count(*) FROM "JuryServiceConnection" c WHERE c.status = 'DISCOVERY_PENDING') AS pending,
  (SELECT count(*) FROM "JuryServiceConnection" c WHERE c.status = 'DISCOVERY_PENDING'
     AND EXISTS (SELECT 1 FROM "JuryAccessScope" s WHERE s."connectionId" = c.id AND s."tenantId" = c."tenantId" AND s.status::text = 'APPROVED')) AS would_activate,
  (SELECT count(*) FROM "JuryServiceMember") AS service_members_now;
