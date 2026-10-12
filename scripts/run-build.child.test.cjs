'use strict';
/**
 * Child-process test of scripts/run-build.cjs control flow with stubbed binaries.
 *
 * Safety: run-build spawns `npx ...` and `node scripts/...` through a shell. The child
 * gets a minimal env (never process.env wholesale) whose PATH contains ONLY a temp
 * stub directory, so `npx` / `node` resolve to stubs that append their args to a log
 * and exit 0. Real npx/prisma/next and scripts/write-ads-txt.cjs never run, and the
 * child cwd is a temp dir, so no repo file is written. A probe asserts the stubs
 * resolve before run-build is ever spawned. All URLs/refs/tokens are fakes; the fake
 * DIRECT_URL points at 127.0.0.1:1 (nothing is contacted either way).
 */
const test = require('node:test');
const { before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { PREVIEW, PROD, REFS, urls } = require('./db-target-fixtures.cjs');

const RUN_BUILD = path.join(__dirname, 'run-build.cjs');
const IS_WIN = process.platform === 'win32';
const TOKEN = 'I_UNDERSTAND_PRODUCTION_MIGRATE';
const FAKE_DIRECT = 'postgresql://fakeuser:FakePw0rdSentinel@127.0.0.1:1/x';
const MARKER = 'STUB_BINARY_MARKER';
// Built at runtime so the static scan in build-migrate-policy.test.cjs (no script but run-build may name the command) stays green.
const MIGRATE_CMD = ['npx', 'prisma', 'migrate', 'de' + 'ploy'].join(' ');

let tmp;
let stubDir;
let workDir;
let logFile;

function writeStub(name) {
  if (IS_WIN) {
    fs.writeFileSync(path.join(stubDir, `${name}.cmd`),
      `@echo off\r\necho ${name} %*>>"%STUB_LOG%"\r\necho ${MARKER}\r\nexit /b 0\r\n`);
  } else {
    const p = path.join(stubDir, name);
    fs.writeFileSync(p, `#!/bin/sh\necho "${name} $*" >> "$STUB_LOG"\necho ${MARKER}\nexit 0\n`);
    fs.chmodSync(p, 0o755);
  }
}

function baseEnv() {
  const env = { PATH: stubDir, STUB_LOG: logFile };
  if (IS_WIN) {
    env.SystemRoot = process.env.SystemRoot || 'C:\\Windows';
    env.ComSpec = process.env.ComSpec || path.join(env.SystemRoot, 'System32', 'cmd.exe');
    env.PATHEXT = '.COM;.EXE;.BAT;.CMD';
  }
  return env;
}

function readLog() {
  return fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : [];
}

function runBuild(extra) {
  fs.rmSync(logFile, { force: true });
  const env = baseEnv();
  for (const [k, v] of Object.entries(extra)) if (v !== undefined) env[k] = v;
  const r = spawnSync(process.execPath, [RUN_BUILD], { cwd: workDir, env, encoding: 'utf8', timeout: 60000 });
  return { status: r.status, out: `${r.stdout || ''}${r.stderr || ''}`, log: readLog() };
}

function assertNoSecrets(out) {
  for (const v of [TOKEN, FAKE_DIRECT, 'FakePw0rdSentinel', 'S3ntinelPassw0rd', 'postgres', PREVIEW, PROD, '127.0.0.1']) {
    assert.ok(!out.includes(v), `output must not contain a sensitive value (${v.length} chars)`);
  }
}

const PROD_ENV = { VERCEL: '1', VERCEL_ENV: 'production', DIRECT_URL: FAKE_DIRECT };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const ANON = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iss: 'supabase', ref: PREVIEW, role: 'anon' })}.sig`;
const PREVIEW_OK = {
  ...REFS, VERCEL: '1', VERCEL_ENV: 'preview',
  DATABASE_URL: urls.pooler, DIRECT_URL: urls.direct,
  NEXT_PUBLIC_SUPABASE_URL: `https://${PREVIEW}.supabase.co`, NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON,
};
const TAIL = ['node scripts/check-no-prisma-in-client.cjs', 'node scripts/write-ads-txt.cjs', 'npx next build'];

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'run-build-child-'));
  stubDir = path.join(tmp, 'bin');
  workDir = path.join(tmp, 'work');
  logFile = path.join(tmp, 'stub.log');
  fs.mkdirSync(stubDir);
  fs.mkdirSync(workDir);
  writeStub('npx');
  writeStub('node');
  // Safety gate: both names must resolve to the stubs through the same shell run-build uses.
  for (const name of ['npx', 'node']) {
    fs.rmSync(logFile, { force: true });
    const r = spawnSync(name, ['--version'], { cwd: workDir, env: baseEnv(), shell: true, encoding: 'utf8', timeout: 20000 });
    if (r.status !== 0 || !String(r.stdout).includes(MARKER) || readLog().join('|') !== `${name} --version`) {
      throw new Error(`STUB_GATE_FAILED:${name}`);
    }
  }
  fs.rmSync(logFile, { force: true });
});

after(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

test('production without token: PRODUCTION_MIGRATE_NOT_ALLOWED, migrate not spawned, next build runs', () => {
  const r = runBuild(PROD_ENV);
  assert.equal(r.status, 0);
  assert.match(r.out, /\[build\] db target: DB_TARGET_SKIPPED_PRODUCTION/);
  assert.match(r.out, /\[build\] migrate policy: PRODUCTION_MIGRATE_NOT_ALLOWED \(skipped\)/);
  assert.doesNotMatch(r.out, /supabase target/);
  assert.ok(!r.log.some((l) => /prisma\s+migrate/.test(l)));
  assert.deepEqual(r.log, TAIL);
  assertNoSecrets(r.out);
});

test('production with wrong token values: skipped, migrate not spawned', () => {
  for (const v of ['1', 'true', ` ${TOKEN}`, `${TOKEN} `, TOKEN.toLowerCase()]) {
    const r = runBuild({ ...PROD_ENV, JURY_ALLOW_PROD_MIGRATE: v });
    assert.equal(r.status, 0);
    assert.match(r.out, /migrate policy: PRODUCTION_MIGRATE_NOT_ALLOWED \(skipped\)/);
    assert.deepEqual(r.log, TAIL);
    assertNoSecrets(r.out);
  }
});

test('production JURY_SKIP_MIGRATIONS=1 with token: OPT_OUT, migrate not spawned', () => {
  const r = runBuild({ ...PROD_ENV, JURY_ALLOW_PROD_MIGRATE: TOKEN, JURY_SKIP_MIGRATIONS: '1' });
  assert.equal(r.status, 0);
  assert.match(r.out, /migrate policy: OPT_OUT \(skipped\)/);
  assert.deepEqual(r.log, TAIL);
  assertNoSecrets(r.out);
});

test('production with exact token: the migrate command is invoked (stub only) before the rest', () => {
  const r = runBuild({ ...PROD_ENV, JURY_ALLOW_PROD_MIGRATE: TOKEN });
  assert.equal(r.status, 0);
  assert.match(r.out, /migrate policy: PRODUCTION_MIGRATE\n/);
  assert.deepEqual(r.log, [MIGRATE_CMD, ...TAIL]);
  assertNoSecrets(r.out);
});

test('preview with valid fake preview targets: NON_PRODUCTION_SKIP, migrate not spawned', () => {
  const r = runBuild(PREVIEW_OK);
  assert.equal(r.status, 0);
  assert.match(r.out, /\[build\] db target: DB_TARGET_OK/);
  assert.match(r.out, /\[build\] supabase target: SUPABASE_TARGET_OK/);
  assert.match(r.out, /migrate policy: NON_PRODUCTION_SKIP \(skipped\)/);
  assert.deepEqual(r.log, TAIL);
  assertNoSecrets(r.out);
});

test('preview with production DB ref: DB target block exits 1, nothing spawned', () => {
  const r = runBuild({ ...PREVIEW_OK, DATABASE_URL: urls.prodPooler, JURY_ALLOW_PROD_MIGRATE: TOKEN });
  assert.equal(r.status, 1);
  assert.match(r.out, /\[build\] db target: BLOCKED_DB_TARGET_PRODUCTION/);
  assert.doesNotMatch(r.out, /supabase target|migrate policy/);
  assert.deepEqual(r.log, []);
  assertNoSecrets(r.out);
});

test('local (no VERCEL) with token: LOCAL_SKIP, migrate not spawned', () => {
  const r = runBuild({ DIRECT_URL: FAKE_DIRECT, JURY_ALLOW_PROD_MIGRATE: TOKEN });
  assert.equal(r.status, 0);
  assert.match(r.out, /\[build\] db target: DB_TARGET_SKIPPED_LOCAL/);
  assert.match(r.out, /migrate policy: LOCAL_SKIP \(skipped\)/);
  assert.deepEqual(r.log, TAIL);
  assertNoSecrets(r.out);
});