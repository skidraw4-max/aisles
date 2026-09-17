-- Community activation Phase 0/1: viewsLast7d, authorKind, stance, comment notify throttle

CREATE TYPE "PostAuthorKind" AS ENUM ('HUMAN', 'SYSTEM', 'AI');
CREATE TYPE "StanceChoice" AS ENUM ('AGREE', 'DISAGREE');

ALTER TABLE "Post" ADD COLUMN "authorKind" "PostAuthorKind" NOT NULL DEFAULT 'HUMAN';

CREATE INDEX "Post_authorKind_createdAt_idx" ON "Post"("authorKind", "createdAt" DESC);

CREATE TABLE "PostViewDaily" (
    "postId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "PostViewDaily_pkey" PRIMARY KEY ("postId","day")
);

CREATE INDEX "PostViewDaily_day_idx" ON "PostViewDaily"("day");

ALTER TABLE "PostViewDaily" ADD CONSTRAINT "PostViewDaily_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PostStance" (
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "choice" "StanceChoice" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PostStance_pkey" PRIMARY KEY ("postId","userId")
);

CREATE INDEX "PostStance_postId_choice_idx" ON "PostStance"("postId", "choice");

ALTER TABLE "PostStance" ADD CONSTRAINT "PostStance_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PostStance" ADD CONSTRAINT "PostStance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CommentNotifyThrottle" (
    "postId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "lastSentAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CommentNotifyThrottle_pkey" PRIMARY KEY ("postId","authorId")
);

-- Backfill provenance from syndication / AI fortune markers
UPDATE "Post" SET "authorKind" = 'SYSTEM'
WHERE "geeknewsOriginalUrl" IS NOT NULL
   OR "hackerNewsOriginalUrl" IS NOT NULL
   OR "lobstersOriginalUrl" IS NOT NULL
   OR "techmemeOriginalUrl" IS NOT NULL
   OR "vergeOriginalUrl" IS NOT NULL
   OR "aiBreakfastOriginalUrl" IS NOT NULL
   OR "mitNewsOriginalUrl" IS NOT NULL
   OR "youtubeVideoId" IS NOT NULL;

UPDATE "Post" SET "authorKind" = 'AI'
WHERE "aiFortuneWeekKey" IS NOT NULL;
