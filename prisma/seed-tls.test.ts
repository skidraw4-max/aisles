import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { planPreviewDbAccess } from '../src/lib/jury-product/preview-db-guard';
import { requirePreviewPgConfig } from '../src/lib/jury-product/preview-db-tls';
import { createSeedPgPool, executeSeed, type SeedDependencies, type SeedEnv } from './seed';

// Dummy refs and urls only. Nothing here connects, builds a real pool, or seeds.
const PREVIEW_REF = 'previewdummyrefaaaaa';
const PRODUCTION_REF = 'productiondummyrefbb';
const previewUrl = `postgres://postgres.${PREVIEW_REF}:secret@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`;
const ordinaryUrl = 'postgres://seed-user:secret@ordinary.example:5432/postgres';
const missingCa = path.join(os.tmpdir(), 'jury-no-such-dir', 'root.crt');
const refEnv = { JURY_PREVIEW_DB_PROJECT_REF: PREVIEW_REF, JURY_PRODUCTION_DB_PROJECT_REFS: PRODUCTION_REF };

type Pool = { end(): Promise<void> };

test('preview pool creation fails closed when TLS cannot be built', () => {
  const created: unknown[] = [];
  assert.throws(
    () => createSeedPgPool(previewUrl, { JURY_PREVIEW_DB: '1', JURY_PREVIEW_DB_CA_PATH: missingCa }, {
      buildTls: requirePreviewPgConfig,
      createPool: (config) => {
        created.push(config);
        return { end: async () => undefined };
      },
    }),
    /^Error: BLOCKED_PREVIEW_TLS$/,
  );
  assert.equal(created.length, 0);
});

test('a preview seed with a missing CA runs the guard first and never creates a pool, client, or row', async () => {
  const order: string[] = [];
  const errors: string[] = [];
  const exits: number[] = [];
  const counts = { pool: 0, prisma: 0, upsert: 0 };
  const env: SeedEnv & { JURY_PREVIEW_DB_CA_PATH: string } = {
    JURY_PREVIEW_DB: '1',
    DATABASE_URL: previewUrl,
    DIRECT_URL: previewUrl,
    JURY_PREVIEW_DB_CA_PATH: missingCa,
    ...refEnv,
  };
  const deps: SeedDependencies = {
    env,
    planAccess: (input) => {
      order.push('plan');
      return planPreviewDbAccess(input);
    },
    createPool: (connectionString) => {
      order.push('createPool');
      return createSeedPgPool(connectionString, env, {
        buildTls: (url, tlsEnv) => {
          order.push('tls');
          return requirePreviewPgConfig(url, tlsEnv);
        },
        createPool: (): Pool => {
          counts.pool += 1;
          return { end: async () => undefined };
        },
      });
    },
    createPrisma: () => {
      counts.prisma += 1;
      return { uiConfig: { upsert: async () => { counts.upsert += 1; } }, $disconnect: async () => undefined };
    },
    log: () => undefined,
    error: (message) => errors.push(message),
    exit: (code) => exits.push(code),
  };
  await executeSeed(deps);
  assert.deepEqual(order, ['plan', 'createPool', 'tls']);
  assert.deepEqual(counts, { pool: 0, prisma: 0, upsert: 0 });
  assert.deepEqual(errors, ['SEED_FAILED']);
  assert.deepEqual(exits, [1]);
});

test('the real guard runs before TLS: a blocked guard never reaches pool creation', async () => {
  const order: string[] = [];
  const errors: string[] = [];
  await executeSeed({
    env: { JURY_PREVIEW_DB: '1', DATABASE_URL: ordinaryUrl, DIRECT_URL: previewUrl, ...refEnv },
    createPool: () => {
      order.push('createPool');
      return { end: async () => undefined };
    },
    createPrisma: () => {
      order.push('prisma');
      return { uiConfig: { upsert: async () => undefined }, $disconnect: async () => undefined };
    },
    log: () => undefined,
    error: (message) => errors.push(message),
    exit: () => undefined,
  });
  assert.deepEqual(order, []);
  assert.deepEqual(errors, ['BLOCKED_PREVIEW_DB']);
});

test('non-preview pool creation is unchanged and never builds TLS', () => {
  for (const flag of [undefined, '', '0', 'true']) {
    const created: unknown[] = [];
    let built = 0;
    createSeedPgPool(ordinaryUrl, flag === undefined ? {} : { JURY_PREVIEW_DB: flag }, {
      buildTls: () => {
        built += 1;
        throw new Error('unexpected');
      },
      createPool: (config) => {
        created.push(config);
        return { end: async () => undefined };
      },
    });
    assert.equal(built, 0);
    assert.deepEqual(created, [{ connectionString: ordinaryUrl }]);
  }
});

test('preview pool creation passes exactly the built connection string and ssl', () => {
  const ssl = { marker: true };
  const created: unknown[] = [];
  createSeedPgPool(previewUrl, { JURY_PREVIEW_DB: '1' }, {
    buildTls: (url) => ({ connectionString: `${url}#built`, ssl }) as never,
    createPool: (config) => {
      created.push(config);
      return { end: async () => undefined };
    },
  });
  assert.deepEqual(created, [{ connectionString: `${previewUrl}#built`, ssl }]);
});
