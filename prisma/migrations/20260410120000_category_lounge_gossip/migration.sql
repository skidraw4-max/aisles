-- Category enum에 LOUNGE, GOSSIP 추가 (이미 있으면 건너뜀)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    JOIN pg_namespace n ON t.typnamespace = n.oid
    WHERE n.nspname = 'public' AND t.typname = 'Category' AND e.enumlabel = 'LOUNGE'
  ) THEN
    ALTER TYPE "Category" ADD VALUE 'LOUNGE';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    JOIN pg_namespace n ON t.typnamespace = n.oid
    WHERE n.nspname = 'public' AND t.typname = 'Category' AND e.enumlabel = 'GOSSIP'
  ) THEN
    ALTER TYPE "Category" ADD VALUE 'GOSSIP';
  END IF;
END $$;
