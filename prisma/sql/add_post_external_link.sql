-- Post.externalLink (선택). db push가 풀러에서 멈출 때 Supabase SQL Editor에서 실행.
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "externalLink" TEXT;
