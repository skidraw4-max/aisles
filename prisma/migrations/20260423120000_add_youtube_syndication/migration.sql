-- YouTube 채널 자동 요약 게시 (MIT OCW / DeepMind)
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "youtubeVideoId" VARCHAR(16);
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "youtubeSyndicationSource" VARCHAR(16);

CREATE UNIQUE INDEX IF NOT EXISTS "Post_youtubeVideoId_key" ON "Post"("youtubeVideoId");
