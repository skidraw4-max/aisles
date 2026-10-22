-- MIT News RSS 자동 수집 — 원문 URL 중복 방지
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "mitNewsOriginalUrl" VARCHAR(2048);

CREATE UNIQUE INDEX IF NOT EXISTS "Post_mitNewsOriginalUrl_key" ON "Post"("mitNewsOriginalUrl");
