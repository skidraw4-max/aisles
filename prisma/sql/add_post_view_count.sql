-- Post 조회수 컬럼 (스키마의 views). Supabase SQL Editor 또는 psql에서 1회 실행.
-- 이미 있으면 무시하려면 IF NOT EXISTS 사용 (PostgreSQL 9.1+)
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "views" INTEGER NOT NULL DEFAULT 0;
