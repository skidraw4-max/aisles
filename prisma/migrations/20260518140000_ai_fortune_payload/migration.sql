-- AI FORTUNE 구조화 페이로드 + User.mbti 제거
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "aiFortunePayload" JSONB;

ALTER TABLE "User" DROP COLUMN IF EXISTS "mbti";
