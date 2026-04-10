-- PostgreSQL: Post.category enum 확장 (Prisma db push 또는 수동 적용)
-- 이미 값이 있으면 해당 줄만 건너뛰면 됩니다.
ALTER TYPE "Category" ADD VALUE 'LOUNGE';
ALTER TYPE "Category" ADD VALUE 'GOSSIP';
