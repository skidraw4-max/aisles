-- MIT News 자동 수집 글을 AI 트렌드(LOUNGE)로 통일
UPDATE "Post"
SET "category" = 'LOUNGE'
WHERE "mitNewsOriginalUrl" IS NOT NULL
  AND "category" = 'TREND';
