-- Techmeme RSS 자동 등록용 원문 URL (중복 방지)
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "techmemeOriginalUrl" VARCHAR(2048);

CREATE UNIQUE INDEX IF NOT EXISTS "Post_techmemeOriginalUrl_key" ON "Post" ("techmemeOriginalUrl");
