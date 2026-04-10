-- PostgreSQL: Category enum에 LOUNGE·GOSSIP (레거시 수동 적용용)
-- 권장: `npx prisma migrate deploy` — prisma/migrations/20260410120000_category_lounge_gossip 참고
-- 이미 값이 있으면 오류가 나므로, 마이그레이션의 DO $$ … 블록을 사용하세요.
ALTER TYPE "Category" ADD VALUE 'LOUNGE';
ALTER TYPE "Category" ADD VALUE 'GOSSIP';
