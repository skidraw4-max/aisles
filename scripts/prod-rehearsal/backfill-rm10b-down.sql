-- RM-10b rollback (needs JD approval). Derived only from rows the backfill itself created; no ids embedded.
--  - grants: JuryServiceMember rows with id prefix 'rm10b:' (app-created grants use random UUIDs, so they are untouched)
--  - connections: back to DISCOVERY_PENDING only where the backfill's own audit row exists
--    (audit id = sha256(tenantId\nSERVICE_CONNECTION_ACTIVATED\nconnectionId), actor 'system:backfill-rm10b'), then those audit rows.
-- updatedAt is not restored (pre-apply values were recorded off-repo at apply time).
-- Production apply 2026-10-22 (KST): 3 grants, 2 connections, 2 audit rows -> expect DELETE 3 / UPDATE 2 / DELETE 2.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DELETE FROM "JuryServiceMember" WHERE id LIKE 'rm10b:%';
UPDATE "JuryServiceConnection" c SET status = 'DISCOVERY_PENDING', "updatedAt" = now()
WHERE c.status = 'CONNECTED'
  AND EXISTS (SELECT 1 FROM "JuryAuditEvent" e
              WHERE e.actor = 'system:backfill-rm10b' AND e.action = 'SERVICE_CONNECTION_ACTIVATED' AND e."tenantId" = c."tenantId"
                AND e.id = encode(sha256(convert_to(c."tenantId" || E'\n' || 'SERVICE_CONNECTION_ACTIVATED' || E'\n' || c.id, 'UTF8')), 'hex'));
DELETE FROM "JuryAuditEvent" WHERE actor = 'system:backfill-rm10b' AND action = 'SERVICE_CONNECTION_ACTIVATED';
COMMIT;
