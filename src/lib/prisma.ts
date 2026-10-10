import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { guardTestDatabase } from '@/lib/jury-product/preview-db-guard';
import { requirePreviewPgConfig } from '@/lib/jury-product/preview-db-tls';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  pool: pg.Pool | undefined;
};

/**
 * PG_POOL_MAX — 인스턴스당 pg.Pool 최대 연결 수.
 * 기본: production 2, development 10.
 *
 * Trade-off:
 * - 높이면 burst 시 대기↓·처리량↑, but (서버리스 인스턴스 수 × max)만큼 DB 연결 소비↑.
 * - 낮추면 총 연결 안전, but 동시 Prisma 호출이 직렬화되어 대기·timeout↑.
 * Supabase Transaction pooler(포트 6543) + DATABASE_URL 사용 권장.
 * burst 완화는 withDbRetry·unstable_cache·graceful fallback과 함께 쓴다.
 */
function resolvePoolMax(): number {
  const fromEnv = process.env.PG_POOL_MAX;
  if (fromEnv != null && fromEnv !== '') {
    const n = Number(fromEnv);
    if (Number.isFinite(n) && n >= 1) return Math.floor(n);
  }
  return process.env.NODE_ENV === 'production' ? 2 : 10;
}

function createPool(connectionString: string): pg.Pool {
  // Preview mode: verified TLS (Supabase CA + hostname) or no connection at all.
  const preview = process.env.JURY_PREVIEW_DB === '1' ? requirePreviewPgConfig(connectionString, process.env) : null;
  return new pg.Pool({
    connectionString: preview ? preview.connectionString : connectionString,
    ...(preview ? { ssl: preview.ssl } : {}),
    max: resolvePoolMax(),
    idleTimeoutMillis: 20_000,
    connectionTimeoutMillis: 8_000,
    allowExitOnIdle: true,
  });
}

function createPrisma(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set');
  }
  guardTestDatabase(process.env);
  const pool = globalForPrisma.pool ?? createPool(connectionString);
  if (!globalForPrisma.pool) {
    globalForPrisma.pool = pool;
  }
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrisma();
if (!globalForPrisma.prisma) {
  globalForPrisma.prisma = prisma;
}
