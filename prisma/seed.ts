import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { UI_CONFIG_SEED } from '../src/lib/ui-config-defaults';

const cs = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!cs) {
  throw new Error('DATABASE_URL 또는 DIRECT_URL이 필요합니다 (시드 실행).');
}

const pool = new pg.Pool({ connectionString: cs });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  for (const row of UI_CONFIG_SEED) {
    await prisma.uiConfig.upsert({
      where: { key: row.key },
      create: {
        key: row.key,
        value: row.value,
        description: row.description,
      },
      update: {
        value: row.value,
        description: row.description,
      },
    });
  }
  console.log(`[seed] UiConfig ${UI_CONFIG_SEED.length} rows upserted.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
