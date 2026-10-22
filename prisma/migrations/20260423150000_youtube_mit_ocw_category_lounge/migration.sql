-- MIT OCW 유튜브 요약 게시글을 AI 트렌드(LOUNGE)로 통일

UPDATE "Post"
SET "category" = 'LOUNGE'::"Category"
WHERE "category" = 'RECIPE'::"Category"
  AND (
    "youtubeSyndicationSource" = 'MIT_OCW'
    OR (
      "youtubeSyndicationSource" IS NULL
      AND "youtubeVideoId" IS NOT NULL
      AND (
        'MIT OCW' = ANY ("tags")
        OR 'MIT OpenCourseWare' = ANY ("tags")
      )
    )
  );
