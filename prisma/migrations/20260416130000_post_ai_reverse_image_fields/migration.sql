-- 갤러리 이미지 역분석 캐시 (추정 프롬프트 + 전체 JSON)
-- IF NOT EXISTS: 로컬에서 prisma db push만 한 경우 등 컬럼이 이미 있어도 migrate deploy가 실패하지 않게 함
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "aiReversePrompt" TEXT;
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "aiImageAnalysis" JSONB;
