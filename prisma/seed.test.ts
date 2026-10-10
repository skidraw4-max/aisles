import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { planPreviewDbAccess } from '../src/lib/jury-product/preview-db-guard';
import { UI_CONFIG_SEED } from '../src/lib/ui-config-defaults';
import {
  executeSeed,
  formatSeedFailure,
  isDirectSeedExecution,
  seedEntrypointStarted,
  type SeedDependencies,
  type SeedEnv,
} from './seed';

const secretUser = 'seed-user';
const secretPassword = 'seed-password';
// Dummy project refs. Real refs are configuration and never appear in source.
const PREVIEW_REF = 'previewdummyrefaaaaa';
const PRODUCTION_REF = 'productiondummyrefbb';
const REF_ENV = { JURY_PREVIEW_DB_PROJECT_REF: PREVIEW_REF, JURY_PRODUCTION_DB_PROJECT_REFS: PRODUCTION_REF };
const unknownHost = 'unknown.example';
const direct = `postgres://${secretUser}:${secretPassword}@db.previewdummyrefaaaaa.supabase.co:5432/postgres`;
const session = `postgres://postgres.${PREVIEW_REF}:${secretPassword}@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`;
const productionDirect = `postgres://${secretUser}:${secretPassword}@db.productiondummyrefbb.supabase.co:5432/postgres`;
const unknown = `postgres://${secretUser}:${secretPassword}@${unknownHost}:5432/postgres?sslmode=require`;
const ordinary = `postgres://${secretUser}:${secretPassword}@ordinary.example:5432/postgres`;
const alternate = `postgres://${secretUser}:${secretPassword}@alternate.example:5432/postgres`;

type Harness = {
  deps: SeedDependencies;
  calls: { pool: number; prisma: number; upsert: number; disconnect: number; end: number; plan: number };
  order: string[];
  errors: string[];
  logs: string[];
  exits: number[];
  connectionStrings: string[];
  planned?: SeedEnv;
};

function harness(env: SeedEnv, hooks?: {
  upsert?: () => Promise<void>;
  createPool?: (connectionString: string) => void;
  disconnect?: () => Promise<void>;
}): Harness {
  env = { ...REF_ENV, ...env };
  const seen: Harness = {
    deps: {
      env,
      planAccess: (input) => input,
      createPool: () => ({ end: async () => undefined }),
      createPrisma: () => ({
        uiConfig: { upsert: async () => undefined },
        $disconnect: async () => undefined,
      }),
      log: () => undefined,
      error: () => undefined,
      exit: () => undefined,
    },
    calls: { pool: 0, prisma: 0, upsert: 0, disconnect: 0, end: 0, plan: 0 },
    order: [],
    errors: [],
    logs: [],
    exits: [],
    connectionStrings: [],
  };
  seen.deps = {
    env,
    planAccess(input) {
      seen.calls.plan += 1;
      seen.order.push('plan');
      seen.planned = input;
      return planPreviewDbAccess(input);
    },
    createPool(connectionString) {
      seen.calls.pool += 1;
      seen.order.push('pool');
      seen.connectionStrings.push(connectionString);
      hooks?.createPool?.(connectionString);
      return {
        async end() {
          seen.calls.end += 1;
        },
      };
    },
    createPrisma() {
      seen.calls.prisma += 1;
      seen.order.push('prisma');
      return {
        uiConfig: {
          async upsert() {
            seen.calls.upsert += 1;
            seen.order.push('upsert');
            await hooks?.upsert?.();
          },
        },
        async $disconnect() {
          seen.calls.disconnect += 1;
          await hooks?.disconnect?.();
        },
      };
    },
    log(message) {
      seen.logs.push(message);
    },
    error(message) {
      seen.errors.push(message);
    },
    exit(code) {
      seen.exits.push(code);
    },
  };
  return seen;
}

function assertNoSecrets(value: string) {
  assert.equal(value.includes('postgres://'), false);
  assert.equal(value.includes('postgresql://'), false);
  assert.equal(value.includes(secretUser), false);
  assert.equal(value.includes(secretPassword), false);
  assert.equal(value.includes(unknownHost), false);
  assert.equal(value.includes('db.productiondummyrefbb.supabase.co'), false);
  assert.equal(value.includes('db.previewdummyrefaaaaa.supabase.co'), false);
  assert.equal(value.includes('aws-0-ap-south-1.pooler.supabase.com'), false);
  assert.equal(value.includes('sslmode'), false);
}

test('importing the seed module does not start the cli', () => {
  assert.equal(seedEntrypointStarted, false);
  const entry = path.resolve('prisma/seed.ts');
  assert.equal(isDirectSeedExecution(entry, pathToFileURL(entry).href), true);
  assert.equal(isDirectSeedExecution(undefined, pathToFileURL(entry).href), false);
  assert.equal(isDirectSeedExecution(path.resolve('prisma/seed.test.ts'), pathToFileURL(entry).href), false);
});

test('preview seed stops before pool creation when a url is outside the allowlist', async () => {
  const seen = harness({
    JURY_PREVIEW_DB: '1',
    DATABASE_URL: unknown,
    DIRECT_URL: session,
  });
  await executeSeed(seen.deps);
  assert.equal(seen.errors.join('\n'), 'BLOCKED_PREVIEW_DB');
  assert.deepEqual(seen.exits, [1]);
  assert.equal(seen.calls.plan, 1);
  assert.equal(seen.calls.pool, 0);
  assert.equal(seen.calls.prisma, 0);
  assert.equal(seen.calls.upsert, 0);
  assert.equal(seen.planned?.DATABASE_URL, unknown);
  assert.equal(seen.planned?.DIRECT_URL, session);
  assertNoSecrets(seen.errors.join('\n'));
});

test('preview seed blocks a production direct hostname without logging the url', async () => {
  const seen = harness({
    JURY_PREVIEW_DB: '1',
    DATABASE_URL: productionDirect,
    DIRECT_URL: productionDirect,
  });
  await executeSeed(seen.deps);
  assert.equal(seen.errors.join('\n'), 'BLOCKED_PRODUCTION_DB');
  assert.deepEqual(seen.exits, [1]);
  assert.equal(seen.calls.pool, 0);
  assert.equal(seen.calls.prisma, 0);
  assert.equal(seen.calls.upsert, 0);
  assertNoSecrets(seen.errors.join('\n'));
});

test('preview seed checks access before creating a connection', async () => {
  const seen = harness({
    JURY_PREVIEW_DB: '1',
    DATABASE_URL: direct,
    DIRECT_URL: session,
  });
  await executeSeed(seen.deps);
  assert.equal(seen.order[0], 'plan');
  assert.equal(seen.order[1], 'pool');
  assert.equal(seen.order[2], 'prisma');
  assert.equal(seen.order[3], 'upsert');
  assert.equal(seen.calls.upsert, UI_CONFIG_SEED.length);
  assert.equal(seen.connectionStrings[0], session);
  assert.deepEqual(seen.exits, []);
  assert.deepEqual(seen.errors, []);
});

test('preview seed uses the real guard when no plan override is injected', async () => {
  const seen = harness({
    JURY_PREVIEW_DB: '1',
    DATABASE_URL: '',
    DIRECT_URL: session,
  });
  delete seen.deps.planAccess;
  await executeSeed(seen.deps);
  assert.equal(seen.errors.join('\n'), 'BLOCKED_PREVIEW_DB');
  assert.equal(seen.calls.pool, 0);
  assert.equal(seen.calls.prisma, 0);
  assert.equal(seen.calls.upsert, 0);
});

test('ordinary seed keeps direct url priority and does not call the preview guard', async () => {
  const seen = harness({
    DATABASE_URL: ordinary,
    DIRECT_URL: alternate,
  });
  await executeSeed(seen.deps);
  assert.equal(seen.calls.plan, 0);
  assert.equal(seen.calls.pool, 1);
  assert.equal(seen.connectionStrings[0], alternate);
  assert.equal(seen.calls.upsert, UI_CONFIG_SEED.length);
  assert.deepEqual(seen.errors, []);

  const fallback = harness({
    DATABASE_URL: ordinary,
    DIRECT_URL: '',
  });
  await executeSeed(fallback.deps);
  assert.equal(fallback.calls.plan, 0);
  assert.equal(fallback.connectionStrings[0], ordinary);
});

test('ordinary seed reports a fixed code when both urls are missing', async () => {
  const seen = harness({});
  await executeSeed(seen.deps);
  assert.equal(seen.errors.join('\n'), 'SEED_FAILED');
  assert.deepEqual(seen.exits, [1]);
  assert.equal(seen.calls.plan, 0);
  assert.equal(seen.calls.pool, 0);
});

test('seed failure logs only a fixed code or a prisma code', async () => {
  const leaked = new Error(`postgres://${secretUser}:${secretPassword}@${unknownHost}:5432/postgres?sslmode=require`);
  Object.assign(leaked, {
    code: 'P1001',
    detail: secretPassword,
    hint: unknownHost,
  });
  const seen = harness({
    DATABASE_URL: ordinary,
    DIRECT_URL: ordinary,
  }, {
    upsert() {
      throw leaked;
    },
  });
  await executeSeed(seen.deps);
  assert.equal(seen.errors.join('\n'), 'SEED_FAILED P1001');
  assert.deepEqual(seen.exits, [1]);
  assert.equal(seen.calls.disconnect, 1);
  assert.equal(seen.calls.end, 1);
  assertNoSecrets(seen.errors.join('\n'));

  const unsafeCode = harness({
    DATABASE_URL: ordinary,
  }, {
    createPool() {
      throw Object.assign(new Error(unknown), { code: 'P1001 extra' });
    },
  });
  await executeSeed(unsafeCode.deps);
  assert.equal(unsafeCode.errors.join('\n'), 'SEED_FAILED');
  assert.equal(unsafeCode.calls.prisma, 0);
  assert.equal(unsafeCode.calls.upsert, 0);
  assertNoSecrets(unsafeCode.errors.join('\n'));

  assert.equal(formatSeedFailure({ code: 'p1001', message: unknown }), 'SEED_FAILED');
  assert.equal(formatSeedFailure(unknown), 'SEED_FAILED');
});

test('preview seed blocks when only one url is the production direct hostname', async () => {
  const cases = [
    { DATABASE_URL: productionDirect, DIRECT_URL: session },
    { DATABASE_URL: direct, DIRECT_URL: productionDirect },
  ];
  for (const env of cases) {
    const seen = harness({
      JURY_PREVIEW_DB: '1',
      ...env,
    });
    await executeSeed(seen.deps);
    assert.equal(seen.errors.join('\n'), 'BLOCKED_PRODUCTION_DB');
    assert.deepEqual(seen.exits, [1]);
    assert.equal(seen.calls.plan, 1);
    assert.equal(seen.order[0], 'plan');
    assert.equal(seen.calls.pool, 0);
    assert.equal(seen.calls.prisma, 0);
    assert.equal(seen.calls.upsert, 0);
    assert.deepEqual(seen.logs, []);
    assertNoSecrets(seen.errors.join('\n'));
  }
});

test('preview seed blocks a non-canonical hostname before pool creation', async () => {
  const seen = harness({
    JURY_PREVIEW_DB: '1',
    DATABASE_URL: `postgres://${secretUser}:${secretPassword}@DB.PREVIEWDUMMYREFAAAAA.SUPABASE.CO:5432/postgres`,
    DIRECT_URL: session,
  });
  await executeSeed(seen.deps);
  assert.equal(seen.errors.join('\n'), 'BLOCKED_PREVIEW_DB');
  assert.deepEqual(seen.exits, [1]);
  assert.equal(seen.calls.plan, 1);
  assert.equal(seen.calls.pool, 0);
  assert.equal(seen.calls.prisma, 0);
  assert.equal(seen.calls.upsert, 0);
  assert.deepEqual(seen.logs, []);
  assertNoSecrets(seen.errors.join('\n'));
  assert.equal(seen.errors.join('\n').includes('SUPABASE'), false);
});

test('ordinary seed stops before pool when either url is a known preview endpoint', async () => {
  const previewTransaction = `postgresql://${secretUser}:${secretPassword}@db.previewdummyrefaaaaa.supabase.co:6543/postgres`;
  const paddedPreview = `postgres://${secretUser}:${secretPassword}@db.previewdummyrefaaaaa.supabase.co:05432/postgres`;
  const cases = [
    { DATABASE_URL: direct, DIRECT_URL: ordinary },
    { DATABASE_URL: ordinary, DIRECT_URL: session },
    { DATABASE_URL: previewTransaction, DIRECT_URL: '' },
    { DATABASE_URL: paddedPreview, DIRECT_URL: ordinary },
  ];
  const flags: Array<string | undefined> = [undefined, '', '0', 'true', 'TRUE'];
  for (const flag of flags) {
    for (const env of cases) {
      const seen = harness({
        ...(flag === undefined ? {} : { JURY_PREVIEW_DB: flag }),
        ...env,
      });
      await executeSeed(seen.deps);
      assert.equal(seen.errors.join('\n'), 'BLOCKED_PREVIEW_DB');
      assert.deepEqual(seen.exits, [1]);
      assert.equal(seen.calls.plan, 0);
      assert.equal(seen.calls.pool, 0);
      assert.equal(seen.calls.prisma, 0);
      assert.equal(seen.calls.upsert, 0);
      assert.deepEqual(seen.logs, []);
      assertNoSecrets(seen.errors.join('\n'));
    }
  }
});

test('ordinary seed keeps a non-preview production url on the existing path', async () => {
  const seen = harness({
    DATABASE_URL: productionDirect,
    DIRECT_URL: ordinary,
  });
  await executeSeed(seen.deps);
  assert.equal(seen.calls.plan, 0);
  assert.equal(seen.calls.pool, 1);
  assert.equal(seen.calls.prisma, 1);
  assert.equal(seen.connectionStrings[0], ordinary);
  assert.equal(seen.calls.upsert, UI_CONFIG_SEED.length);
  assert.deepEqual(seen.errors, []);
  assertNoSecrets(seen.logs.join('\n'));
});

test('ordinary seed ignores preview host text outside the hostname', async () => {
  const previewHost = 'db.previewdummyrefaaaaa.supabase.co';
  const cases = [
    { DATABASE_URL: 'not a url', DIRECT_URL: ordinary },
    { DATABASE_URL: `postgres://${previewHost}:${secretPassword}@ordinary.example:5432/postgres`, DIRECT_URL: '' },
    { DATABASE_URL: `postgres://${secretUser}:aws-0-ap-south-1.pooler.supabase.com@ordinary.example:5432/postgres`, DIRECT_URL: '' },
    { DATABASE_URL: `postgres://${secretUser}:${secretPassword}@ordinary.example:5432/${previewHost}`, DIRECT_URL: '' },
    { DATABASE_URL: `postgres://${secretUser}:${secretPassword}@ordinary.example:5432/postgres?host=${previewHost}`, DIRECT_URL: '' },
  ];
  for (const env of cases) {
    const seen = harness(env);
    await executeSeed(seen.deps);
    assert.equal(seen.calls.plan, 0);
    assert.equal(seen.calls.pool, 1);
    assert.equal(seen.calls.prisma, 1);
    assert.equal(seen.calls.upsert, UI_CONFIG_SEED.length);
    assert.deepEqual(seen.errors, []);
    assertNoSecrets(seen.logs.join('\n'));
    assert.equal(seen.logs.join('\n').includes(previewHost), false);
  }
});

test('seed keeps the ordinary path unless the preview flag is exactly 1', async () => {
  const flags: Array<string | undefined> = [undefined, '', '0', 'true', 'TRUE'];
  for (const flag of flags) {
    const seen = harness({
      ...(flag === undefined ? {} : { JURY_PREVIEW_DB: flag }),
      DATABASE_URL: ordinary,
      DIRECT_URL: alternate,
    });
    await executeSeed(seen.deps);
    assert.equal(seen.calls.plan, 0);
    assert.equal(seen.calls.pool, 1);
    assert.equal(seen.calls.prisma, 1);
    assert.equal(seen.connectionStrings[0], alternate);
    assert.equal(seen.calls.upsert, UI_CONFIG_SEED.length);
    assert.deepEqual(seen.errors, []);
    assert.deepEqual(seen.exits, []);
    assertNoSecrets(seen.logs.join('\n'));
  }

  const enabled = harness({
    JURY_PREVIEW_DB: '1',
    DATABASE_URL: direct,
    DIRECT_URL: session,
  });
  await executeSeed(enabled.deps);
  assert.equal(enabled.calls.plan, 1);
  assert.equal(enabled.order[0], 'plan');
  assert.equal(enabled.calls.pool, 1);
  assert.equal(enabled.connectionStrings[0], session);
});

test('seed close failures do not log the exception object', async () => {
  const seen = harness({
    DATABASE_URL: ordinary,
  }, {
    disconnect() {
      throw new Error(`postgres://${secretUser}:${secretPassword}@${unknownHost}/postgres?sslmode=require`);
    },
  });
  await executeSeed(seen.deps);
  assert.equal(seen.errors.join('\n'), 'SEED_FAILED');
  assert.deepEqual(seen.exits, [1]);
  assertNoSecrets(seen.errors.join('\n'));
});

test('seed fails closed for supabase-hosted urls when the ref configuration is missing', async () => {
  const cases: SeedEnv[] = [
    { DATABASE_URL: productionDirect, DIRECT_URL: ordinary },
    { DATABASE_URL: ordinary, DIRECT_URL: session },
    { JURY_PREVIEW_DB: '1', DATABASE_URL: direct, DIRECT_URL: session },
  ];
  for (const env of cases) {
    const seen = harness(env);
    seen.deps.env = env;
    await executeSeed(seen.deps);
    assert.equal(seen.errors.join('\n'), 'BLOCKED_PREVIEW_DB');
    assert.deepEqual(seen.exits, [1]);
    assert.equal(seen.calls.pool, 0);
    assert.equal(seen.calls.upsert, 0);
    assertNoSecrets(seen.errors.join('\n'));
  }
  const ordinaryOnly = harness({ DATABASE_URL: ordinary, DIRECT_URL: alternate });
  ordinaryOnly.deps.env = { DATABASE_URL: ordinary, DIRECT_URL: alternate };
  await executeSeed(ordinaryOnly.deps);
  assert.equal(ordinaryOnly.calls.pool, 1);
  assert.deepEqual(ordinaryOnly.errors, []);
});