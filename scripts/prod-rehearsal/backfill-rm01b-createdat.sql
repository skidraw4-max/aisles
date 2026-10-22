-- RM-01b (proposal, needs JD approval): set pre-RM-01 JuryReviewRequest.createdAt/updatedAt to the
-- linked result's completedAt instead of the migration timestamp. Only UNKNOWN_LEGACY rows that have no
-- attempt row (= created before RM-01). Idempotent. Rows without a result are left unchanged.
BEGIN;
UPDATE "JuryReviewRequest" q SET "createdAt" = r."completedAt", "updatedAt" = r."completedAt"
FROM (SELECT "reviewRequestId", min("completedAt") "completedAt" FROM "JuryReviewResult" GROUP BY 1) r
WHERE r."reviewRequestId" = q.id AND q."resultSource" = 'UNKNOWN_LEGACY'
  AND NOT EXISTS (SELECT 1 FROM "JuryReviewAttempt" a WHERE a."reviewRequestKey" = q.id)
  AND q."createdAt" IS DISTINCT FROM r."completedAt";
COMMIT;
