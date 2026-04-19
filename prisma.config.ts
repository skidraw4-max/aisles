// Prisma CLI(db push, migrate 등)는 .env 의 DIRECT_URL 을 사용합니다.
// 직접 DB: 사용자 postgres + db.*.supabase.co / 풀러: postgres.<ref> + *.pooler.supabase.com (대시보드 URI 그대로)
import { defineConfig } from '@prisma/config';
import 'dotenv/config';

export default defineConfig({
  datasource: {
    /**
     * Prisma CLI(migrate 등): Supabase는 **직접 연결** 권장(풀러 6543은 migrate에 부적합).
     * 로컬에 DIRECT_URL 없으면 DATABASE_URL 폴백(주의: 풀러면 migrate 실패 가능).
     */
    url: process.env.DIRECT_URL || process.env.DATABASE_URL,
  },
});
