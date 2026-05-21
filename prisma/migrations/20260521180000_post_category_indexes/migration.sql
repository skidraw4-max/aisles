-- Post list / home feed query indexes
CREATE INDEX IF NOT EXISTS "Post_category_createdAt_idx" ON "Post"("category", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "Post_featuredOnHome_launchBannerUntil_idx" ON "Post"("featuredOnHome", "launchBannerUntil");
