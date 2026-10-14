// Prisma CLI(db push, migrate 등)는 .env 의 DIRECT_URL 을 사용합니다.
// 직접 DB: 사용자 postgres + db.*.supabase.co / 풀러: postgres.<ref> + *.pooler.supabase.com (대시보드 URI 그대로)
import { defineConfig } from '@prisma/config';
import 'dotenv/config';
import { resolveCliDatasourceUrl } from './src/lib/jury-product/prisma-cli-tls';

export default defineConfig({
  datasource: {
    /**
     * Prisma CLI(migrate 등): Supabase는 **직접 연결** 권장(풀러 6543은 migrate에 부적합).
     * 로컬에 DIRECT_URL 없으면 DATABASE_URL 폴백(주의: 풀러면 migrate 실패 가능).
     */
    // PRISMA_CLI_DATABASE_URL > DIRECT_URL > DATABASE_URL. With JURY_DB_CLI_TLS=verify (or JURY_PREVIEW_DB=1)
    // only PRISMA_CLI_DATABASE_URL is used and must pass the CLI TLS policy, else BLOCKED_CLI_TLS:<reason>.
    url: resolveCliDatasourceUrl(process.env, process.argv),
  },
  /** Prisma 7: `prisma db seed`는 여기서만 읽음 (`package.json`의 prisma.seed 무시) */
  migrations: {
    seed: 'tsx prisma/seed.ts',
  },
});
