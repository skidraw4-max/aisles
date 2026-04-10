-- Post 조회수 컬럼: viewCount → views (기존 DB 호환)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Post' AND column_name = 'views'
  ) THEN
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'Post' AND column_name = 'viewCount'
    ) THEN
      ALTER TABLE "Post" RENAME COLUMN "viewCount" TO "views";
    ELSE
      ALTER TABLE "Post" ADD COLUMN "views" INTEGER NOT NULL DEFAULT 0;
    END IF;
  END IF;
END $$;
