-- GeekNews 자동 등록 글(category는 기존 GOSSIP)을 LOUNGE로 일괄 변경
UPDATE "Post"
SET category = 'LOUNGE'::"Category"
WHERE "geeknewsOriginalUrl" IS NOT NULL
  AND category = 'GOSSIP'::"Category";
