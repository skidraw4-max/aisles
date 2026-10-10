import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';
import { run } from './run-preview-db-test.mjs';

// Dummy refs and urls only. Nothing here reads .env.preview, spawns a test, or connects.
const PREVIEW_REF = 'previewdummyrefaaaaa';
const PRODUCTION_REF = 'productiondummyrefbb';
const previewUrl = `postgres://postgres.${PREVIEW_REF}:secret@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`;
const envText = [
  `DATABASE_URL=${previewUrl}`,
  `DIRECT_URL=${previewUrl}`,
  `JURY_PREVIEW_DB_PROJECT_REF=${PREVIEW_REF}`,
  `JURY_PRODUCTION_DB_PROJECT_REFS=${PRODUCTION_REF}`,
].join('\n');
const testSource = "test('one exact name', () => {});";
const argv = ['node', 'run-preview-db-test.mjs', '--file', 'x.test.ts', '--name', 'one exact name'];

function harness(overrides = {}) {
  const calls = { readPreviewEnv: 0, plan: 0, buildTls: 0, spawn: 0, order: [], logs: [], spawnArgs: null };
  const deps = {
    env: { BASE: 'kept' },
    cwd: 'CWD',
    execPath: 'NODE',
    readSource: () => testSource,
    readPreviewEnv: () => { calls.readPreviewEnv += 1; calls.order.push('env'); return envText; },
    plan: () => { calls.plan += 1; calls.order.push('plan'); return { ok: true }; },
    buildTls: () => { calls.buildTls += 1; calls.order.push('tls'); return { ok: true, connectionString: 'x', ssl: {} }; },
    spawnTest: (...args) => { calls.spawn += 1; calls.order.push('spawn'); calls.spawnArgs = args; return { status: 0, stdout: 'ok', stderr: '' }; },
    log: (message) => calls.logs.push(message),
    write: () => undefined,
    ...overrides,
  };
  return { deps, calls };
}

test('missing arguments stop before reading anything', async () => {
  const { deps, calls } = harness();
  assert.equal(await run(['node', 'x'], deps), 2);
  assert.deepEqual(calls.order, []);
  assert.deepEqual(calls.logs, ['BLOCKED_PREVIEW_DB']);
});

test('a guard failure stops before any TLS build or test process', async () => {
  const { deps, calls } = harness({ plan: () => { calls.order.push('plan'); return { ok: false, status: 'BLOCKED_PRODUCTION_DB' }; } });
  assert.equal(await run(argv, deps), 2);
  assert.equal(calls.buildTls, 0);
  assert.equal(calls.spawn, 0);
  assert.deepEqual(calls.logs, ['BLOCKED_PRODUCTION_DB']);
});

test('a TLS build failure exits 2 before any test process', async () => {
  const { deps, calls } = harness({ buildTls: () => { calls.buildTls += 1; return { ok: false, status: 'BLOCKED_PREVIEW_TLS' }; } });
  assert.equal(await run(argv, deps), 2);
  assert.equal(calls.buildTls, 1);
  assert.equal(calls.spawn, 0);
  assert.deepEqual(calls.logs, ['BLOCKED_PREVIEW_TLS']);
});

test('the real guard and TLS builder block a missing CA before any test process', async () => {
  const missingCa = path.join(os.tmpdir(), 'jury-no-such-dir', 'root.crt');
  const spawned = [];
  const logs = [];
  const code = await run(argv, {
    env: { JURY_PREVIEW_DB_CA_PATH: missingCa },
    readSource: () => testSource,
    readPreviewEnv: () => envText,
    spawnTest: (...args) => { spawned.push(args); return { status: 0 }; },
    log: (message) => logs.push(message),
    write: () => undefined,
  });
  assert.equal(code, 2);
  assert.equal(spawned.length, 0);
  assert.deepEqual(logs, ['BLOCKED_PREVIEW_TLS']);
  assert.equal(logs.join('').includes('postgres://'), false);
});

test('a TLS success spawns the same exact test command and env as before', async () => {
  const { deps, calls } = harness({ write: (text) => calls.logs.push(text) });
  deps.spawnTest = (...args) => { calls.spawn += 1; calls.order.push('spawn'); calls.spawnArgs = args; return { status: 7, stdout: `x ${previewUrl} y`, stderr: '' }; };
  assert.equal(await run(argv, deps), 7);
  assert.deepEqual(calls.order, ['env', 'plan', 'tls', 'tls', 'spawn']);
  const [command, args, options] = calls.spawnArgs;
  assert.equal(command, 'NODE');
  assert.deepEqual(args, ['--import', 'tsx', '--test', '--test-name-pattern', '^one exact name$', 'x.test.ts']);
  assert.deepEqual(Object.keys(options), ['cwd', 'env', 'encoding', 'shell']);
  assert.equal(options.cwd, 'CWD');
  assert.equal(options.encoding, 'utf8');
  assert.equal(options.shell, false);
  assert.deepEqual(options.env, {
    BASE: 'kept',
    JURY_PREVIEW_DB: '1',
    DATABASE_URL: previewUrl,
    DIRECT_URL: previewUrl,
    JURY_PREVIEW_DB_PROJECT_REF: PREVIEW_REF,
    JURY_PRODUCTION_DB_PROJECT_REFS: PRODUCTION_REF,
  });
  assert.deepEqual(calls.logs, ['x [redacted] y']);
});
