-- Synthetic rows mirroring production SHAPES and COUNTS only (no production values, no PII).
-- Prod shape (2026-10-22 read-only): 2 tenants, 2 OWNER memberships, 2 connections both DISCOVERY_PENDING
-- (FILE_UPLOAD with 1 APPROVED scope + 4 grants; READ_ONLY_ACCOUNT with 2 APPROVED scopes + AGENT only),
-- 5 COMPLETED FULL_REVIEW requests (4 AISLE_SELF, 1 EXTERNAL_SERVICE), 5 results incl. a fixture-run
-- result (id aa734100…) and a re-review child (id 37072025…), 7 evidence, 39 metrics, 15 users.
BEGIN;
INSERT INTO "User"(id, username, email) SELECT 'syn-user-'||g, 'syn'||g, 'syn'||g||'@example.invalid' FROM generate_series(1,15) g;
INSERT INTO "JuryTenant"(id,name) VALUES ('540a4714-syn-tenant-a','Synthetic Org A'),('77aa0000-syn-tenant-b','Synthetic Org B');
INSERT INTO "JuryMembership"(id,"tenantId","userId",role) VALUES
 ('syn-mem-a','540a4714-syn-tenant-a','syn-user-1','OWNER'),('syn-mem-b','77aa0000-syn-tenant-b','syn-user-2','OWNER');
INSERT INTO "JuryServiceConnection"(id,"tenantId","serviceKey","displayName","accessMethod",status,"createdByUserId","updatedAt") VALUES
 ('ee93d8e6-syn-conn-self','540a4714-syn-tenant-a','aisle-self','Synthetic self','FILE_UPLOAD','DISCOVERY_PENDING','syn-user-1',now()),
 ('ee7399b4-syn-conn-ext','540a4714-syn-tenant-a','github:synthetic/repo','Synthetic external','READ_ONLY_ACCOUNT','DISCOVERY_PENDING','syn-user-1',now());
INSERT INTO "JuryAccessScope"(id,"tenantId","connectionId",status,grants,"approvedByUserId","approvedAt") VALUES
 ('syn-scope-1','540a4714-syn-tenant-a','ee93d8e6-syn-conn-self','APPROVED','[]','syn-user-1',now()),
 ('syn-scope-2','540a4714-syn-tenant-a','ee7399b4-syn-conn-ext','APPROVED','[]','syn-user-1',now()),
 ('syn-scope-3','540a4714-syn-tenant-a','ee7399b4-syn-conn-ext','APPROVED','[]','syn-user-1',now());
INSERT INTO "JuryServiceMember"(id,"tenantId","connectionId","userId",permission)
 SELECT 'syn-sm-'||p,'540a4714-syn-tenant-a','ee93d8e6-syn-conn-self','syn-user-1',p::"JuryServicePermission" FROM unnest(ARRAY['VIEW','REVIEW','IMPROVE','AGENT']) p
 UNION ALL SELECT 'syn-sm-ext-AGENT','540a4714-syn-tenant-a','ee7399b4-syn-conn-ext','syn-user-1','AGENT';
INSERT INTO "JuryEvidence"(id,"tenantId","connectionId",purpose,"periodStart","periodEnd",timezone,"metricIds","adapterKey","collectedAt","piiExcluded","readOnly")
 SELECT 'syn-ev-'||g,'540a4714-syn-tenant-a', CASE WHEN g=2 THEN 'ee7399b4-syn-conn-ext' ELSE 'ee93d8e6-syn-conn-self' END,
  'synthetic','2026-09-01','2026-09-30','Asia/Seoul','[]','synthetic',now(),true,true FROM generate_series(1,7) g;
-- 17 metrics on ev-1 (self), 1 on ev-2 (external), 21 spread on ev-3..7 => 39
INSERT INTO "JuryNormalizedMetric"(id,"tenantId","connectionId","evidenceId",metric,unit,value,"periodStart","periodEnd",timezone,"sourceSystem","sourceRef","collectedAt",availability,"rawPayloadRef","adapterKey","adapterVersion","ruleId")
 SELECT 'syn-m-'||e||'-'||g,'540a4714-syn-tenant-a', CASE WHEN e=2 THEN 'ee7399b4-syn-conn-ext' ELSE 'ee93d8e6-syn-conn-self' END,'syn-ev-'||e,
  'metric_'||g,'COUNT',g,'2026-09-01','2026-09-30','Asia/Seoul','DATABASE','synthetic',now(),'AVAILABLE','synthetic','synthetic','1','rule'
 FROM (SELECT 1 e, generate_series(1,17) g UNION ALL SELECT 2,1 UNION ALL SELECT 3+(g%5), g FROM generate_series(1,21) g) x;
UPDATE "JuryEvidence" ev SET "metricIds"=(SELECT jsonb_agg(m.id) FROM "JuryNormalizedMetric" m WHERE m."evidenceId"=ev.id);
INSERT INTO "JuryReviewRequest"(id,"tenantId","connectionId","evidenceId","reviewType",mode,status,"coreRootDir","requestedByUserId") VALUES
 ('86eb73e3-syn-rr','540a4714-syn-tenant-a','ee93d8e6-syn-conn-self','syn-ev-1','FULL_REVIEW','AISLE_SELF','COMPLETED','data/jury-product','syn-user-1'),
 ('96db5810-syn-rr','540a4714-syn-tenant-a','ee93d8e6-syn-conn-self','syn-ev-1','FULL_REVIEW','AISLE_SELF','COMPLETED','data/jury-product','syn-user-1'),
 ('dc64ee12-syn-rr','540a4714-syn-tenant-a','ee93d8e6-syn-conn-self','syn-ev-1','FULL_REVIEW','AISLE_SELF','COMPLETED','data/jury-product','syn-user-1'),
 ('28760112-syn-rr','540a4714-syn-tenant-a','ee93d8e6-syn-conn-self','syn-ev-1','FULL_REVIEW','AISLE_SELF','COMPLETED','data/jury-product','syn-user-1'),
 ('469fdf07-syn-rr','540a4714-syn-tenant-a','ee7399b4-syn-conn-ext','syn-ev-2','FULL_REVIEW','EXTERNAL_SERVICE','COMPLETED','data/jury-product','syn-user-1');
WITH fs AS (SELECT '{"statusSummary":"synthetic","expectedUserEffect":"synthetic","risk":"synthetic","topProblems":[],"dimensionEvidence":[],"supportedClaims":[],"partiallySupportedClaims":[],"hypotheses":[]}'::jsonb j)
INSERT INTO "JuryReviewResult"(id,"tenantId","reviewRequestId","boardRunId","evidenceStrength","claimStrength","conflictDetected","overclaimDetected","revisionRequired","expectedDecision","finalSurface","contractVersion","completedAt","parentReviewResultId")
 SELECT v.id,'540a4714-syn-tenant-a',v.rr,v.run,v.es::"JuryEvidenceStrength",'weak',false,false,v.dec<>'VERIFY',v.dec::"JuryDecision",fs.j,'v9.x-ev020',v.at::timestamp,v.parent
 FROM fs, (VALUES
  ('2f6638a0-syn-res','86eb73e3-syn-rr','run-2026-syn-1','strong','VERIFY','2026-10-01 15:32:34.609',NULL),
  ('6adbe715-syn-res','96db5810-syn-rr','run-2026-syn-2','strong','VERIFY','2026-10-01 16:23:58.057','2f6638a0-syn-res'),
  ('aa734100-syn-res','dc64ee12-syn-rr','fixture-syn-3','moderate','REWORD','2026-10-01 16:43:21.477',NULL),
  ('37072025-syn-res','28760112-syn-rr','run-2026-syn-mock-4','strong','VERIFY','2026-10-01 17:30:43.561','6adbe715-syn-res'),
  ('10a856f7-syn-res','469fdf07-syn-rr','run-2026-syn-5','moderate','REWORD','2026-10-21 07:27:29.889',NULL)) v(id,rr,run,es,dec,at,parent);
COMMIT;
