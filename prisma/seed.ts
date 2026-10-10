import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import {
  isKnownPreviewEndpoint,
  isSupabaseHostedEndpoint,
  planPreviewDbAccess,
  readPreviewDbRefConfig,
  type PreviewDbEnv,
} from '../src/lib/jury-product/preview-db-guard';
import { UI_CONFIG_SEED } from '../src/lib/ui-config-defaults';

const SEED_FAILED = 'SEED_FAILED';
const PRISMA_CODE = /^P\d{4}$/;

export type SeedEnv = PreviewDbEnv;

type SeedPool = {
  end(): Promise<void>;
};

type SeedClient = {
  uiConfig: {
    upsert(args: {
      where: { key: string };
      create: { key: string; value: string; description: string };
      update: { value: string; description: string };
    }): Promise<unknown>;
  };
  $disconnect(): Promise<void>;
};

export type SeedDependencies = {
  env: SeedEnv;
  planAccess?: typeof planPreviewDbAccess;
  createPool: (connectionString: string) => SeedPool;
  createPrisma: (pool: SeedPool) => SeedClient;
  log: (message: string) => void;
  error: (message: string) => void;
  exit: (code: number) => void;
};

export let seedEntrypointStarted = false;

export function isDirectSeedExecution(entry: string | undefined, moduleUrl: string): boolean {
  if (!entry) return false;
  return moduleUrl === pathToFileURL(path.resolve(entry)).href;
}

export function formatSeedFailure(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && PRISMA_CODE.test(code)) return `${SEED_FAILED} ${code}`;
  }
  return SEED_FAILED;
}

async function releaseSeed(prisma: SeedClient | undefined, pool: SeedPool | undefined): Promise<boolean> {
  let failed = false;
  if (prisma) {
    try {
      await prisma.$disconnect();
    } catch {
      failed = true;
    }
  }
  if (pool) {
    try {
      await pool.end();
    } catch {
      failed = true;
    }
  }
  return failed;
}

// Without a valid ref configuration a Supabase-hosted URL cannot be told apart from Preview, so it fails closed.
function ordinarySeedTouchesPreview(env: SeedEnv): boolean {
  const refs = readPreviewDbRefConfig(env);
  const urls = [env.DATABASE_URL, env.DIRECT_URL];
  if (!refs) return urls.some((url) => isSupabaseHostedEndpoint(url));
  return urls.some((url) => isKnownPreviewEndpoint(url, refs));
}

export async function executeSeed(deps: SeedDependencies): Promise<void> {
  if (deps.env.JURY_PREVIEW_DB === '1') {
    const plan = deps.planAccess ?? planPreviewDbAccess;
    const decision = plan({
      JURY_PREVIEW_DB: deps.env.JURY_PREVIEW_DB,
      DATABASE_URL: deps.env.DATABASE_URL,
      DIRECT_URL: deps.env.DIRECT_URL,
      JURY_PREVIEW_DB_PROJECT_REF: deps.env.JURY_PREVIEW_DB_PROJECT_REF,
      JURY_PRODUCTION_DB_PROJECT_REFS: deps.env.JURY_PRODUCTION_DB_PROJECT_REFS,
    });
    if (!decision.ok) {
      deps.error(decision.status);
      deps.exit(1);
      return;
    }
  } else if (ordinarySeedTouchesPreview(deps.env)) {
    deps.error('BLOCKED_PREVIEW_DB');
    deps.exit(1);
    return;
  }

  const connectionString = deps.env.DIRECT_URL || deps.env.DATABASE_URL;
  if (!connectionString) {
    deps.error(SEED_FAILED);
    deps.exit(1);
    return;
  }

  let pool: SeedPool | undefined;
  let prisma: SeedClient | undefined;
  let failed = false;
  try {
    pool = deps.createPool(connectionString);
    prisma = deps.createPrisma(pool);
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
    deps.log(`[seed] UiConfig ${UI_CONFIG_SEED.length} rows upserted.`);
  } catch (error) {
    failed = true;
    deps.error(formatSeedFailure(error));
  } finally {
    const releaseFailed = await releaseSeed(prisma, pool);
    if (releaseFailed && !failed) {
      failed = true;
      deps.error(SEED_FAILED);
    }
  }
  if (failed) deps.exit(1);
}

async function runFromCli(): Promise<void> {
  seedEntrypointStarted = true;
  await import('dotenv/config');
  await executeSeed({
    env: {
      JURY_PREVIEW_DB: process.env.JURY_PREVIEW_DB,
      DATABASE_URL: process.env.DATABASE_URL,
      DIRECT_URL: process.env.DIRECT_URL,
      JURY_PREVIEW_DB_PROJECT_REF: process.env.JURY_PREVIEW_DB_PROJECT_REF,
      JURY_PRODUCTION_DB_PROJECT_REFS: process.env.JURY_PRODUCTION_DB_PROJECT_REFS,
    },
    createPool: (connectionString) => new pg.Pool({ connectionString }),
    createPrisma: (pool) => new PrismaClient({ adapter: new PrismaPg(pool as pg.Pool) }),
    log: (message) => {
      console.log(message);
    },
    error: (message) => {
      console.error(message);
    },
    exit: (code) => {
      process.exit(code);
    },
  });
}

if (isDirectSeedExecution(process.argv[1], import.meta.url)) {
  void runFromCli();
}
