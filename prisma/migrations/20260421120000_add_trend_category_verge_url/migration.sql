-- AlterEnum
ALTER TYPE "Category" ADD VALUE 'TREND';

-- AlterTable
ALTER TABLE "Post" ADD COLUMN "vergeOriginalUrl" VARCHAR(2048);

-- CreateIndex
CREATE UNIQUE INDEX "Post_vergeOriginalUrl_key" ON "Post"("vergeOriginalUrl");
