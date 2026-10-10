'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { decideDbTarget } = require('./build-db-target-policy.cjs');
const { cases, PREVIEW, PROD, PROD_PCT, OTHER, PW, REFS, urls } = require('./db-target-fixtures.cjs');

const CODE = { ok: 'DB_TARGET_OK', production: 'BLOCKED_DB_TARGET_PRODUCTION', config: 'BLOCKED_DB_TARGET_CONFIG', unverified: 'BLOCKED_DB_TARGET_UNVERIFIED' };
const SECRETS = [PW, PREVIEW, PROD, PROD_PCT, OTHER, 'postgres://', 'postgresql://', 'supabase', 'pooler'];

function assertNoSecrets(text) {
  for (const s of SECRETS) assert.equal(String(text).includes(s), false, 'sensitive token leaked');
}

for (const [name, env, verdict] of cases) {
  test(`preview: ${name} -> ${CODE[verdict]}`, () => {
    const result = decideDbTarget({ VERCEL: '1', VERCEL_ENV: 'preview', ...env });
    assert.deepEqual(result, { ok: verdict === 'ok', code: CODE[verdict] });
    assertNoSecrets(JSON.stringify(result));
  });
}

test('production and local builds are unchanged (skipped, ok)', () => {
  const bad = { DATABASE_URL: urls.prodDirect, DIRECT_URL: urls.garbage, ...REFS };
  assert.deepEqual(decideDbTarget({ VERCEL: '1', VERCEL_ENV: 'production', ...bad }), { ok: true, code: 'DB_TARGET_SKIPPED_PRODUCTION' });
  assert.deepEqual(decideDbTarget(bad), { ok: true, code: 'DB_TARGET_SKIPPED_LOCAL' });
  assert.deepEqual(decideDbTarget({ VERCEL: '1', VERCEL_ENV: 'development' }), { ok: true, code: 'DB_TARGET_SKIPPED_LOCAL' });
  assert.deepEqual(decideDbTarget(undefined), { ok: true, code: 'DB_TARGET_SKIPPED_LOCAL' });
});

test('preview with an empty env fails closed (CONFIG)', () => {
  assert.deepEqual(decideDbTarget({ VERCEL_ENV: 'preview' }), { ok: false, code: CODE.config });
});

test('policy sources carry no real-looking hardcoded refs', () => {
  for (const f of ['scripts/build-db-target-policy.cjs', 'src/lib/jury-product/db-target-classifier.cjs', 'scripts/run-build.cjs']) {
    const src = fs.readFileSync(path.join(process.cwd(), f), 'utf8');
    assert.equal(/['`][a-z]{20}['`]/.test(src), false, f);
    assert.equal(/db\.[a-z]{20}\.supabase\.co/.test(src), false, f);
  }
});

test('run-build.cjs: target check precedes decideMigrate, the migrate call and next build; exits 1 on block', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'scripts/run-build.cjs'), 'utf8');
  const at = (needle) => {
    const i = src.indexOf(needle);
    assert.notEqual(i, -1, needle);
    return i;
  };
  const target = at('decideDbTarget(process.env)');
  const exit = at('if (!target.ok) {\n  process.exit(1);') >= 0 ? src.indexOf('if (!target.ok)') : -1;
  assert.ok(target < exit);
  assert.ok(exit < at('decideMigrate(process.env)'));
  assert.ok(exit < at(['migrate', 'dep' + 'loy'].map((w) => `'${w}'`).join(', ')));
  assert.ok(exit < at("'next', 'build'"));
  assert.ok(exit < at('check-no-prisma-in-client'));
  assert.equal(src.split('decideDbTarget(').length - 1, 1);
  // Only the fixed code is logged.
  assert.match(src, /console\.log\(`\[build\] db target: \$\{target\.code\}`\);/);
});

test('run-build.cjs child process: blocked preview exits 1 before spawning anything, logs only the code', () => {
  const env = {
    PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
    VERCEL: '1', VERCEL_ENV: 'preview', ...REFS, DATABASE_URL: urls.direct, DIRECT_URL: urls.prodPooler,
  };
  const r = spawnSync(process.execPath, ['scripts/run-build.cjs'], { cwd: process.cwd(), env, encoding: 'utf8', timeout: 20000 });
  assert.equal(r.status, 1);
  const out = `${r.stdout}${r.stderr}`;
  assert.equal(out.trim(), '[build] db target: BLOCKED_DB_TARGET_PRODUCTION');
  assert.equal(out.includes('migrate policy'), false);
  assertNoSecrets(out);
});

test('run-build.cjs child process: preview with missing config exits 1 with CONFIG', () => {
  const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, VERCEL: '1', VERCEL_ENV: 'preview', DATABASE_URL: urls.direct };
  const r = spawnSync(process.execPath, ['scripts/run-build.cjs'], { cwd: process.cwd(), env, encoding: 'utf8', timeout: 20000 });
  assert.equal(r.status, 1);
  assert.equal(`${r.stdout}${r.stderr}`.trim(), '[build] db target: BLOCKED_DB_TARGET_CONFIG');
});