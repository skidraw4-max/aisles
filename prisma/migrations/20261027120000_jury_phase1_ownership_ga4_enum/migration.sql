-- I-072 (Phase 1): additive enum value for the GA4 viewer-invite connection method.
-- Kept in its own migration because ALTER TYPE ... ADD VALUE cannot be used in the same transaction that uses the value.
-- Existing enum values are unchanged.
ALTER TYPE "JuryAccessMethod" ADD VALUE IF NOT EXISTS 'GA4_VIEWER';
