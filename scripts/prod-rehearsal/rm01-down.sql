-- RM-01 rollback (down) for 20261022130000_jury_review_tracking_rm01.
-- DESTRUCTIVE: drops JuryReviewAttempt / JuryLlmCallLog rows and the 4 new JuryReviewRequest columns.
-- Run only with JD approval, after the app version that writes these columns is rolled back.
BEGIN;
SET LOCAL lock_timeout = '5s';
DROP TABLE IF EXISTS "JuryLlmCallLog";
DROP TABLE IF EXISTS "JuryReviewAttempt";
ALTER TABLE "JuryReviewRequest"
  DROP COLUMN IF EXISTS "createdAt",
  DROP COLUMN IF EXISTS "failureReason",
  DROP COLUMN IF EXISTS "resultSource",
  DROP COLUMN IF EXISTS "updatedAt";
DROP TYPE IF EXISTS "JuryResultSource";
DELETE FROM "_prisma_migrations" WHERE migration_name = '20261022130000_jury_review_tracking_rm01';
COMMIT;
