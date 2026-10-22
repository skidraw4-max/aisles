-- AI FORTUNE 복도 + User MBTI + 주간 운세 중복 방지 키
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    JOIN pg_namespace n ON t.typnamespace = n.oid
    WHERE n.nspname = 'public' AND t.typname = 'Category' AND e.enumlabel = 'AI_FORTUNE'
  ) THEN
    ALTER TYPE "Category" ADD VALUE 'AI_FORTUNE';
  END IF;
END $$;

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "mbti" VARCHAR(4);

ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "aiFortuneWeekKey" VARCHAR(32);

CREATE UNIQUE INDEX IF NOT EXISTS "Post_aiFortuneWeekKey_key" ON "Post"("aiFortuneWeekKey");
