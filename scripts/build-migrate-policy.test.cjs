'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { decideMigrate } = require('./build-migrate-policy.cjs');

const URL = 'postgresql://u:secretpw@h/db';
const prod = (extra = {}) => ({ VERCEL: '1', VERCEL_ENV: 'production', ...extra });

test('local build with DIRECT_URL skips', () => {
  assert.deepEqual(decideMigrate({ DIRECT_URL: URL }), { run: false, reason: 'LOCAL_SKIP' });
  assert.deepEqual(decideMigrate({ VERCEL: '', VERCEL_ENV: 'production', DIRECT_URL: URL }), { run: false, reason: 'LOCAL_SKIP' });
  assert.deepEqual(decideMigrate(undefined), { run: false, reason: 'LOCAL_SKIP' });
});

test('preview and development skip', () => {
  for (const v of ['preview', 'development']) {
    assert.deepEqual(decideMigrate({ VERCEL: '1', VERCEL_ENV: v, DIRECT_URL: URL }), { run: false, reason: 'NON_PRODUCTION_SKIP' });
  }
});

test('missing, empty or unexpected VERCEL_ENV skips', () => {
  assert.deepEqual(decideMigrate({ VERCEL: '1', DIRECT_URL: URL }), { run: false, reason: 'NON_PRODUCTION_SKIP' });
  for (const v of ['', 'Production', 'prod', 'PRODUCTION', ' production']) {
    assert.deepEqual(decideMigrate({ VERCEL: '1', VERCEL_ENV: v, DIRECT_URL: URL }), { run: false, reason: 'NON_PRODUCTION_SKIP' });
  }
});

test('production with valid DIRECT_URL runs', () => {
  assert.deepEqual(decideMigrate(prod({ DIRECT_URL: URL })), { run: true, reason: 'PRODUCTION_MIGRATE' });
});

test('production with missing or whitespace DIRECT_URL skips', () => {
  for (const d of [undefined, '', '   ', '\t\n']) {
    const env = prod();
    if (d !== undefined) env.DIRECT_URL = d;
    assert.deepEqual(decideMigrate(env), { run: false, reason: 'NO_DIRECT_URL' });
  }
});

test('JURY_SKIP_MIGRATIONS=1 skips', () => {
  assert.deepEqual(decideMigrate(prod({ DIRECT_URL: URL, JURY_SKIP_MIGRATIONS: '1' })), { run: false, reason: 'OPT_OUT' });
  assert.deepEqual(decideMigrate(prod({ DIRECT_URL: URL, JURY_SKIP_MIGRATIONS: '0' })), { run: true, reason: 'PRODUCTION_MIGRATE' });
});

test('results never contain URL or secret', () => {
  const envs = [
    { DIRECT_URL: URL },
    { VERCEL: '1', VERCEL_ENV: 'preview', DIRECT_URL: URL },
    prod({ DIRECT_URL: URL, JURY_SKIP_MIGRATIONS: '1' }),
    prod({ DIRECT_URL: URL }),
  ];
  for (const env of envs) {
    const r = decideMigrate(env);
    assert.deepEqual(Object.keys(r).sort(), ['reason', 'run']);
    assert.match(r.reason, /^[A-Z_]+$/);
    const s = JSON.stringify(r);
    assert.ok(!s.includes('secretpw'));
    assert.ok(!s.includes('postgresql://'));
  }
});

test('run-build.cjs: single migrate invocation gated by decideMigrate; no other script invokes it', () => {
  const dir = __dirname;
  const src = fs.readFileSync(path.join(dir, 'run-build.cjs'), 'utf8');
  const invoke = /['"]migrate['"]\s*,\s*['"]deploy['"]/g;
  assert.equal((src.match(invoke) || []).length, 1);
  assert.match(src, /require\(['"]\.\/build-migrate-policy\.cjs['"]\)/);
  assert.match(src, /decideMigrate\(process\.env\)/);
  const gate = src.indexOf('if (decision.run)');
  const call = src.search(invoke);
  assert.ok(gate !== -1 && call > gate);
  assert.ok(!/DIRECT_URL/.test(src.replace(/^\s*(\/\*\*|\*).*$/gm, '')), 'no DIRECT_URL-based logic in code');
  for (const f of fs.readdirSync(dir)) {
    if (f === 'run-build.cjs' || f === path.basename(__filename)) continue;
    const p = path.join(dir, f);
    if (!fs.statSync(p).isFile()) continue;
    const t = fs.readFileSync(p, 'utf8');
    assert.ok(!/migrate\s+deploy/.test(t) && !invoke.test(t), `${f} must not invoke migrate deploy`);
    invoke.lastIndex = 0;
  }
});