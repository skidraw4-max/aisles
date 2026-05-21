-- UGC hub: LAUNCH main banner fields
ALTER TABLE "Post" ADD COLUMN "featuredOnHome" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Post" ADD COLUMN "launchBannerUntil" TIMESTAMP(3);

CREATE INDEX "Post_launch_banner_idx" ON "Post" ("category", "featuredOnHome", "launchBannerUntil");
