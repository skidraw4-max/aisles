-- 로컬/원격 DB에 Notice 테이블이 없을 때 수동 적용용 (이미 있으면 건너뜀)
CREATE TABLE IF NOT EXISTS "Notice" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "link" TEXT,
    "isRolling" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notice_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Notice_isRolling_priority_createdAt_idx"
  ON "Notice" ("isRolling", "priority" DESC, "createdAt" DESC);

-- 기존 테이블에 content 컬럼만 없을 때
ALTER TABLE "Notice" ADD COLUMN IF NOT EXISTS "content" TEXT NOT NULL DEFAULT '';
