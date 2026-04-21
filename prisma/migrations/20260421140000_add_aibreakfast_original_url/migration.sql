-- AlterTable
ALTER TABLE "Post" ADD COLUMN "aiBreakfastOriginalUrl" VARCHAR(2048);

-- CreateIndex
CREATE UNIQUE INDEX "Post_aiBreakfastOriginalUrl_key" ON "Post"("aiBreakfastOriginalUrl");
