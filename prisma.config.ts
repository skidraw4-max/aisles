// Prisma CLI(db push, migrate 등)는 .env 의 DIRECT_URL 을 사용합니다.
// 직접 DB: 사용자 postgres + db.*.supabase.co / 풀러: postgres.<ref> + *.pooler.supabase.com (대시보드 URI 그대로)
import { defineConfig } from '@prisma/config';
import 'dotenv/config';

export default defineConfig({
  datasource: {
    /** 마이그레이션: Supabase는 DIRECT_URL(세션) 권장. CI에 없으면 DATABASE_URL로 폴백 */
    url: process.env.DIRECT_URL || process.env.DATABASE_URL,
  },
});
