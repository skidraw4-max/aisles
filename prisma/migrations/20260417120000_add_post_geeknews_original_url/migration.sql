-- GeekNews 크론: 원문 URL 기준 중복 방지 (NULL은 여러 행 허용)
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "geeknewsOriginalUrl" VARCHAR(2048);

CREATE UNIQUE INDEX IF NOT EXISTS "Post_geeknewsOriginalUrl_key" ON "Post" ("geeknewsOriginalUrl");
