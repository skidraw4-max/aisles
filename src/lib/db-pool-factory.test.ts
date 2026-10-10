import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import type pg from 'pg';
import { createGuardedPool, resolvePoolConnection, type PoolCtor } from './db-pool-factory';

const require = createRequire(import.meta.url);
const { PREVIEW, PROD, PW, REFS, urls } = require('../../scripts/db-target-fixtures.cjs') as {
  PREVIEW: string; PROD: string; PW: string; REFS: Record<string, string>; urls: Record<string, string>;
};

function fakePool() {
  const calls: pg.PoolConfig[] = [];
  const Pool = class {
    constructor(config: pg.PoolConfig) {
      calls.push(config);
    }
  } as unknown as PoolCtor;
  return { Pool, calls };
}

const blockedEnvs: [string, Record<string, string | undefined>, string][] = [
  ['preview + production ref', { VERCEL_ENV: 'preview', ...REFS, DATABASE_URL: urls.prodPooler }, 'BLOCKED_PRODUCTION_DB'],
  ['preview + mixed DIRECT_URL', { VERCEL_ENV: 'preview', ...REFS, DATABASE_URL: urls.direct, DIRECT_URL: urls.prodDirect }, 'BLOCKED_PRODUCTION_DB'],
  ['preview, no ref config', { VERCEL_ENV: 'preview', JURY_PREVIEW_DB: '1', DATABASE_URL: urls.direct }, 'BLOCKED_PREVIEW_DB'],
  ['preview, no JURY_PREVIEW_DB', { VERCEL_ENV: 'preview', ...REFS, JURY_PREVIEW_DB: undefined, DATABASE_URL: urls.direct }, 'BLOCKED_PREVIEW_DB'],
  ['preview, pooler without ref', { VERCEL_ENV: 'preview', ...REFS, DATABASE_URL: urls.poolerNoRef }, 'BLOCKED_PREVIEW_DB'],
  ['JURY_PREVIEW_DB=1 only, other project', { ...REFS, DATABASE_URL: urls.otherDirect }, 'BLOCKED_PREVIEW_DB'],
  ['ssl weakening param', { VERCEL_ENV: 'preview', ...REFS, DATABASE_URL: `${urls.direct}?sslmode=disable` }, 'BLOCKED_PREVIEW_DB'],
];

for (const [name, env, code] of blockedEnvs) {
  test(`pool is never constructed: ${name} -> ${code}`, () => {
    const { Pool, calls } = fakePool();
    assert.throws(() => createGuardedPool(env.DATABASE_URL ?? '', env, { max: 2 }, { Pool }), (e: Error) => e.message === code);
    assert.equal(calls.length, 0);
  });
}

const edge = require('../../scripts/db-target-fixtures.cjs') as {
  edgeCases: [string, Record<string, string | undefined>, 'ok' | 'production' | 'config' | 'unverified'][];
  PROD_PCT: string; OTHER: string;
};
const SENTINELS = [PW, PREVIEW, PROD, edge.PROD_PCT, edge.OTHER, PROD.toUpperCase(), 'postgres://', 'postgres.', 'supabase', 'pooler'];

for (const [name, env, verdict] of edge.edgeCases) {
  test(`t74 boundary via pool factory: ${name}`, () => {
    const { Pool, calls } = fakePool();
    const previewEnv = { VERCEL_ENV: 'preview', ...env };
    if (verdict === 'ok') {
      createGuardedPool(previewEnv.DATABASE_URL ?? '', previewEnv, { max: 2 }, { Pool });
      assert.equal(calls.length, 1);
      return;
    }
    const code = verdict === 'production' ? 'BLOCKED_PRODUCTION_DB' : 'BLOCKED_PREVIEW_DB';
    let caught: Error | undefined;
    try {
      createGuardedPool(previewEnv.DATABASE_URL ?? '', previewEnv, { max: 2 }, { Pool });
    } catch (error) {
      caught = error as Error;
    }
    assert.ok(caught, 'expected a block');
    assert.equal(caught.message, code);
    assert.equal(calls.length, 0, 'Pool constructor must not be called');
    const text = `${caught.message}\n${caught.stack}\n${JSON.stringify(caught)}`;
    for (const s of SENTINELS) assert.equal(text.includes(s), false, 'sensitive token leaked');
  });
}

test('JURY_PREVIEW_DB values other than "1" do not switch preview mode on by themselves (local unchanged)', () => {
  for (const v of ['true', 'false', '', ' 1', '1 ', '01', 'yes']) {
    const { Pool, calls } = fakePool();
    // Without VERCEL_ENV=preview this is the unchanged local path (no guard, no ssl object).
    createGuardedPool(urls.direct, { JURY_PREVIEW_DB: v }, { max: 2 }, { Pool });
    assert.equal(calls.length, 1);
    assert.equal('ssl' in calls[0]!, false);
    // With VERCEL_ENV=preview the same value fails closed before any Pool.
    const blocked = fakePool();
    assert.throws(
      () => createGuardedPool(urls.direct, { VERCEL_ENV: 'preview', ...REFS, JURY_PREVIEW_DB: v, DATABASE_URL: urls.direct }, { max: 2 }, { Pool: blocked.Pool }),
      (e: Error) => e.message === 'BLOCKED_PREVIEW_DB',
    );
    assert.equal(blocked.calls.length, 0);
  }
});

test('target OK but TLS/CA cannot be secured -> BLOCKED_PREVIEW_TLS, pool never constructed', () => {
  const { Pool, calls } = fakePool();
  const env = { VERCEL_ENV: 'preview', ...REFS, DATABASE_URL: urls.direct, JURY_PREVIEW_DB_CA_PATH: 'relative/ca.pem' };
  assert.throws(() => createGuardedPool(urls.direct, env, { max: 2 }, { Pool }), (e: Error) => e.message === 'BLOCKED_PREVIEW_TLS');
  const env2 = { VERCEL_ENV: 'preview', ...REFS, DATABASE_URL: urls.direct };
  assert.throws(
    () => createGuardedPool(urls.direct, env2, { max: 2 }, { Pool, tls: { readFile: () => Buffer.from('not a pem') } }),
    (e: Error) => e.message === 'BLOCKED_PREVIEW_TLS',
  );
  assert.equal(calls.length, 0);
});

test('verified preview target: pool gets pinned CA + hostname verification', () => {
  const { Pool, calls } = fakePool();
  const env = { VERCEL_ENV: 'preview', ...REFS, DATABASE_URL: urls.pooler };
  createGuardedPool(urls.pooler, env, { max: 2 }, { Pool });
  assert.equal(calls.length, 1);
  const ssl = calls[0]!.ssl as { rejectUnauthorized: boolean; servername: string; ca: string; checkServerIdentity: unknown };
  assert.equal(ssl.rejectUnauthorized, true);
  assert.equal(ssl.servername, new URL(urls.pooler).hostname);
  assert.equal(typeof ssl.checkServerIdentity, 'function');
  assert.match(ssl.ca, /BEGIN CERTIFICATE/);
});

test('non-preview (production/local) is unchanged: no guard, no ssl object', () => {
  const { Pool, calls } = fakePool();
  createGuardedPool(urls.garbage, { VERCEL_ENV: 'production' }, { max: 2 }, { Pool });
  createGuardedPool(urls.direct, {}, { max: 10 }, { Pool });
  assert.equal(calls.length, 2);
  assert.equal('ssl' in calls[0]!, false);
  assert.equal(calls[1]!.max, 10);
  assert.deepEqual(resolvePoolConnection(urls.direct, {}), { connectionString: urls.direct });
});

function importPrisma(env: Record<string, string | undefined>) {
  return spawnSync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '-e', "await import('./src/lib/prisma.ts');"],
    {
      cwd: path.resolve(process.cwd()),
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, NODE_ENV: 'production', ...env },
      encoding: 'utf8',
      timeout: 60000,
    },
  );
}

test('module load: importing prisma.ts with a production ref in Preview throws the fixed code (no secrets)', () => {
  const r = importPrisma({ VERCEL_ENV: 'preview', ...REFS, DATABASE_URL: urls.prodPooler, DIRECT_URL: urls.direct });
  assert.notEqual(r.status, 0);
  const out = `${r.stdout}${r.stderr}`;
  assert.match(out, /BLOCKED_PRODUCTION_DB/);
  for (const s of [PW, PREVIEW, PROD, 'postgres://']) assert.equal(out.includes(s), false, 'leak');
});

test('module load: importing prisma.ts in Preview without ref config throws BLOCKED_PREVIEW_DB', () => {
  const r = importPrisma({ VERCEL_ENV: 'preview', DATABASE_URL: urls.direct });
  assert.notEqual(r.status, 0);
  const out = `${r.stdout}${r.stderr}`;
  assert.match(out, /BLOCKED_PREVIEW_DB/);
  assert.equal(out.includes(PW), false);
});