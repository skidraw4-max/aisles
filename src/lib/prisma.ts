import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  pool: pg.Pool | undefined;
};

/** Vercel 서버리스: 인스턴스당 1~2 연결이면 충분 (Supabase Transaction pooler 6543 권장) */
function resolvePoolMax(): number {
  const fromEnv = process.env.PG_POOL_MAX;
  if (fromEnv != null && fromEnv !== '') {
    const n = Number(fromEnv);
    if (Number.isFinite(n) && n >= 1) return Math.floor(n);
  }
  return process.env.NODE_ENV === 'production' ? 1 : 10;
}

function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({
    connectionString,
    max: resolvePoolMax(),
    idleTimeoutMillis: 20_000,
    connectionTimeoutMillis: 10_000,
    allowExitOnIdle: true,
  });
}

function createPrisma(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set');
  }
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
