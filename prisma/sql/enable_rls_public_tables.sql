/* Supabase linter 0013 rls_disabled_in_public — PostgREST용 anon 차단. Prisma(소유자)는 RLS 우회. */

ALTER TABLE "public"."User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."Post" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."AiMetadata" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."LaunchInfo" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."PostLike" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."Comment" ENABLE ROW LEVEL SECURITY;
