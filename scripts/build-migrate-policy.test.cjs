'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { decideMigrate, PROD_MIGRATE_CONFIRMATION } = require('./build-migrate-policy.cjs');

const URL = 'postgresql://u:secretpw@h/db';
const TOKEN = 'I_UNDERSTAND_PRODUCTION_MIGRATE';
const prod = (extra = {}) => ({ VERCEL: '1', VERCEL_ENV: 'production', ...extra });
const allowed = (extra = {}) => prod({ JURY_ALLOW_PROD_MIGRATE: TOKEN, ...extra });

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

test('confirmation token constant is the exact literal', () => {
  assert.equal(PROD_MIGRATE_CONFIRMATION, TOKEN);
});

test('production without allow token skips by default', () => {
  assert.deepEqual(decideMigrate(prod({ DIRECT_URL: URL })), { run: false, reason: 'PRODUCTION_MIGRATE_NOT_ALLOWED' });
  assert.deepEqual(decideMigrate(prod()), { run: false, reason: 'PRODUCTION_MIGRATE_NOT_ALLOWED' });
});

test('production with wrong allow values skips', () => {
  const wrong = ['', '1', 'true', 'TRUE', 'yes', ' ' + TOKEN, TOKEN + ' ', TOKEN + '\n', TOKEN.toLowerCase(), 'I_UNDERSTAND_PRODUCTION_MIGRATION', 'I UNDERSTAND PRODUCTION MIGRATE'];
  for (const v of wrong) {
    assert.deepEqual(decideMigrate(prod({ DIRECT_URL: URL, JURY_ALLOW_PROD_MIGRATE: v })), { run: false, reason: 'PRODUCTION_MIGRATE_NOT_ALLOWED' }, JSON.stringify(v));
  }
});

test('production with exact token and valid DIRECT_URL runs', () => {
  assert.deepEqual(decideMigrate(allowed({ DIRECT_URL: URL })), { run: true, reason: 'PRODUCTION_MIGRATE' });
});

test('production with missing or whitespace DIRECT_URL skips', () => {
  for (const d of [undefined, '', '   ', '\t\n']) {
    const env = allowed();
    if (d !== undefined) env.DIRECT_URL = d;
    assert.deepEqual(decideMigrate(env), { run: false, reason: 'NO_DIRECT_URL' });
  }
});

test('JURY_SKIP_MIGRATIONS=1 skips', () => {
  assert.deepEqual(decideMigrate(prod({ DIRECT_URL: URL, JURY_SKIP_MIGRATIONS: '1' })), { run: false, reason: 'OPT_OUT' });
  assert.deepEqual(decideMigrate(allowed({ DIRECT_URL: URL, JURY_SKIP_MIGRATIONS: '1' })), { run: false, reason: 'OPT_OUT' });
  assert.deepEqual(decideMigrate(allowed({ DIRECT_URL: URL, JURY_SKIP_MIGRATIONS: '0' })), { run: true, reason: 'PRODUCTION_MIGRATE' });
  assert.deepEqual(decideMigrate(prod({ DIRECT_URL: URL, JURY_SKIP_MIGRATIONS: '0' })), { run: false, reason: 'PRODUCTION_MIGRATE_NOT_ALLOWED' });
});

test('allow token does not affect preview or local', () => {
  assert.deepEqual(decideMigrate({ DIRECT_URL: URL, JURY_ALLOW_PROD_MIGRATE: TOKEN }), { run: false, reason: 'LOCAL_SKIP' });
  assert.deepEqual(decideMigrate({ VERCEL: '1', VERCEL_ENV: 'preview', DIRECT_URL: URL, JURY_ALLOW_PROD_MIGRATE: TOKEN }), { run: false, reason: 'NON_PRODUCTION_SKIP' });
});

test('results never contain URL or secret', () => {
  const envs = [
    { DIRECT_URL: URL },
    { VERCEL: '1', VERCEL_ENV: 'preview', DIRECT_URL: URL },
    prod({ DIRECT_URL: URL, JURY_SKIP_MIGRATIONS: '1' }),
    prod({ DIRECT_URL: URL }),
    prod({ DIRECT_URL: URL, JURY_ALLOW_PROD_MIGRATE: '1' }),
    allowed({ DIRECT_URL: URL }),
    allowed({ DIRECT_URL: '  ' }),
  ];
  for (const env of envs) {
    const r = decideMigrate(env);
    assert.deepEqual(Object.keys(r).sort(), ['reason', 'run']);
    assert.match(r.reason, /^[A-Z_]+$/);
    const s = JSON.stringify(r);
    assert.ok(!s.includes('secretpw'));
    assert.ok(!s.includes('postgresql://'));
    assert.ok(!s.includes(TOKEN), 'token value never echoed');
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