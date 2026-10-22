-- GameScore: per-game weekly / overall personal bests
CREATE TABLE IF NOT EXISTS "GameScore" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gameSlug" VARCHAR(64) NOT NULL,
    "mode" VARCHAR(32) NOT NULL,
    "score" INTEGER NOT NULL,
    "weekKey" VARCHAR(16) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GameScore_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "GameScore_userId_gameSlug_mode_weekKey_key"
ON "GameScore"("userId", "gameSlug", "mode", "weekKey");

CREATE INDEX IF NOT EXISTS "GameScore_gameSlug_mode_weekKey_score_idx"
ON "GameScore"("gameSlug", "mode", "weekKey", "score" DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'GameScore_userId_fkey'
  ) THEN
    ALTER TABLE "GameScore"
      ADD CONSTRAINT "GameScore_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
