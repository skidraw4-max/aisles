import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { checkSupabaseTarget, requireSupabaseTarget } from './supabase-target-guard.cjs';

const require = createRequire(import.meta.url);
const { PREVIEW, PROD, OTHER, REFS, urls } = require('../../../scripts/db-target-fixtures.cjs') as {
  PREVIEW: string; PROD: string; OTHER: string; REFS: Record<string, string>; urls: Record<string, string>;
};

const SENTINEL = 'S3ntinelSigXyz';
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (payload: Record<string, unknown>) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.${SENTINEL}`;
const ANON = jwt({ iss: 'supabase', ref: PREVIEW, role: 'anon' });
const SERVICE = jwt({ iss: 'supabase', ref: PREVIEW, role: 'service_role' });
const URL_OK = `https://${PREVIEW}.supabase.co`;
const base = (over: Record<string, string | undefined> = {}) => ({
  VERCEL_ENV: 'preview', ...REFS,
  NEXT_PUBLIC_SUPABASE_URL: URL_OK, NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SERVICE,
  ...over,
});
const code = (env: Record<string, string | undefined>, opts?: Parameters<typeof checkSupabaseTarget>[1]) => checkSupabaseTarget(env, opts).code;

test('preview: matching URL and legacy JWT keys pass with verified keyRef', () => {
  assert.deepEqual(checkSupabaseTarget(base(), { requireServiceKey: true }), { ok: true, code: 'SUPABASE_TARGET_OK', keyRef: 'verified' });
  assert.equal(code(base({ NEXT_PUBLIC_SUPABASE_URL: `${URL_OK}/` })), 'SUPABASE_TARGET_OK');
  assert.equal(code({ ...base(), VERCEL_ENV: undefined, JURY_PREVIEW_DB: '1' }), 'SUPABASE_TARGET_OK');
});

test('non-preview scope is skipped (Production/local unchanged)', () => {
  for (const env of [{ VERCEL_ENV: 'production', NEXT_PUBLIC_SUPABASE_URL: `https://${PROD}.supabase.co` }, {}, { VERCEL_ENV: 'development' }]) {
    assert.deepEqual(checkSupabaseTarget(env, { requireServiceKey: true }), { ok: true, code: 'SUPABASE_TARGET_SKIPPED' });
  }
});

test('config invalid -> SUPABASE_TARGET_CONFIG', () => {
  assert.equal(code(base({ JURY_PREVIEW_DB_PROJECT_REF: undefined })), 'SUPABASE_TARGET_CONFIG');
  assert.equal(code(base({ JURY_PRODUCTION_DB_PROJECT_REFS: '' })), 'SUPABASE_TARGET_CONFIG');
  // overlapping refs: the well-formed 'production' ref matches the URL, so production-first applies (still fail-closed)
  assert.equal(code(base({ JURY_PRODUCTION_DB_PROJECT_REFS: PREVIEW })), 'BLOCKED_SUPABASE_PRODUCTION');
  assert.equal(code(base({ JURY_PRODUCTION_DB_PROJECT_REFS: PREVIEW, NEXT_PUBLIC_SUPABASE_URL: undefined, NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined, SUPABASE_SERVICE_ROLE_KEY: undefined })), 'SUPABASE_TARGET_CONFIG');
});

test('production ref is blocked first (URL, JWT ref, raw key), even before URL/key shape checks', () => {
  assert.equal(code(base({ NEXT_PUBLIC_SUPABASE_URL: `https://${PROD}.supabase.co` })), 'BLOCKED_SUPABASE_PRODUCTION');
  assert.equal(code(base({ NEXT_PUBLIC_SUPABASE_URL: `http://${PROD}.supabase.co:99/x?y` })), 'BLOCKED_SUPABASE_PRODUCTION');
  assert.equal(code(base({ NEXT_PUBLIC_SUPABASE_URL: `https://${PROD.toUpperCase()}.supabase.co` })), 'BLOCKED_SUPABASE_PRODUCTION');
  assert.equal(code(base({ NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt({ ref: PROD, role: 'anon' }) })), 'BLOCKED_SUPABASE_PRODUCTION');
  assert.equal(code(base({ SUPABASE_SERVICE_ROLE_KEY: jwt({ ref: PROD, role: 'service_role' }) }), { requireServiceKey: true }), 'BLOCKED_SUPABASE_PRODUCTION');
  assert.equal(code(base({ NEXT_PUBLIC_SUPABASE_URL: undefined, NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt({ ref: PROD, role: 'anon' }) })), 'BLOCKED_SUPABASE_PRODUCTION');
  // broken config but recognisable production mention still reports production
  assert.equal(code(base({ JURY_PREVIEW_DB_PROJECT_REF: 'bad', NEXT_PUBLIC_SUPABASE_URL: `https://${PROD}.supabase.co` })), 'BLOCKED_SUPABASE_PRODUCTION');
});

test('URL missing / malformed / lookalike -> fixed codes', () => {
  assert.equal(code(base({ NEXT_PUBLIC_SUPABASE_URL: undefined })), 'BLOCKED_SUPABASE_URL_MISSING');
  assert.equal(code(base({ NEXT_PUBLIC_SUPABASE_URL: '   ' })), 'BLOCKED_SUPABASE_URL_MISSING');
  for (const bad of [
    `http://${PREVIEW}.supabase.co`,
    `https://${PREVIEW}.supabase.co:443`,
    `https://${PREVIEW}.supabase.co:8443`,
    `https://${PREVIEW}.supabase.co/rest/v1`,
    `https://${PREVIEW}.supabase.co?x=1`,
    `https://${PREVIEW}.supabase.co#f`,
    `https://user:pw@${PREVIEW}.supabase.co`,
    `https://${PREVIEW}.supabase.co.evil.com`,
    `https://evil.${PREVIEW}.supabase.co`,
    `https://${PREVIEW}.supabase.com`,
    `https://${PREVIEW.toUpperCase()}.supabase.co`,
    `HTTPS://${PREVIEW}.SUPABASE.CO`,
    `https://${OTHER}.supabase.co`,
    'not a url',
  ]) {
    assert.equal(code(base({ NEXT_PUBLIC_SUPABASE_URL: bad })), 'BLOCKED_SUPABASE_UNVERIFIED', bad.replace(PREVIEW, '<ref>'));
  }
});

test('legacy JWT: wrong ref / role / swapped keys -> KEY_MISMATCH', () => {
  assert.equal(code(base({ NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt({ ref: OTHER, role: 'anon' }) })), 'BLOCKED_SUPABASE_KEY_MISMATCH');
  assert.equal(code(base({ NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt({ ref: PREVIEW, role: 'authenticated' }) })), 'BLOCKED_SUPABASE_KEY_MISMATCH');
  assert.equal(code(base({ NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt({ role: 'anon' }) })), 'BLOCKED_SUPABASE_KEY_MISMATCH');
  // swapped
  assert.equal(code(base({ NEXT_PUBLIC_SUPABASE_ANON_KEY: SERVICE })), 'BLOCKED_SUPABASE_KEY_MISMATCH');
  assert.equal(code(base({ SUPABASE_SERVICE_ROLE_KEY: ANON }), { requireServiceKey: true, checkAnonKey: false }), 'BLOCKED_SUPABASE_KEY_MISMATCH');
});

test('sb_ keys: right prefix allowed but marked unverifiable; wrong prefix -> mismatch', () => {
  const pub = `sb_publishable_${SENTINEL}`;
  const sec = `sb_secret_${SENTINEL}`;
  assert.deepEqual(checkSupabaseTarget(base({ NEXT_PUBLIC_SUPABASE_ANON_KEY: pub, SUPABASE_SERVICE_ROLE_KEY: sec }), { requireServiceKey: true }),
    { ok: true, code: 'SUPABASE_TARGET_OK_KEY_REF_UNVERIFIABLE', keyRef: 'unverifiable' });
  assert.equal(code(base({ NEXT_PUBLIC_SUPABASE_ANON_KEY: sec })), 'BLOCKED_SUPABASE_KEY_MISMATCH');
  assert.equal(code(base({ SUPABASE_SERVICE_ROLE_KEY: pub }), { requireServiceKey: true, checkAnonKey: false }), 'BLOCKED_SUPABASE_KEY_MISMATCH');
  assert.equal(code(base({ NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_' })), 'BLOCKED_SUPABASE_KEY_MISMATCH');
});

test('undecodable / missing keys', () => {
  for (const bad of ['garbage', 'a.b', `x.${Buffer.from('not json').toString('base64url')}.y`, `a.${b64([1])}.c`, 'a.b+c.d']) {
    assert.equal(code(base({ NEXT_PUBLIC_SUPABASE_ANON_KEY: bad })), 'BLOCKED_SUPABASE_KEY_UNDECODABLE');
  }
  assert.equal(code(base({ NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined })), 'BLOCKED_SUPABASE_KEY_MISSING');
  assert.equal(code(base({ SUPABASE_SERVICE_ROLE_KEY: undefined }), { requireServiceKey: true }), 'BLOCKED_SUPABASE_KEY_MISSING');
  // service key optional unless required/present-checked
  assert.equal(code(base({ SUPABASE_SERVICE_ROLE_KEY: 'garbage' })), 'SUPABASE_TARGET_OK');
  assert.equal(code(base({ SUPABASE_SERVICE_ROLE_KEY: 'garbage' }), { checkServiceKeyIfPresent: true }), 'BLOCKED_SUPABASE_KEY_UNDECODABLE');
  assert.equal(code(base({ SUPABASE_SERVICE_ROLE_KEY: undefined }), { checkServiceKeyIfPresent: true }), 'SUPABASE_TARGET_OK');
});

test('no input leaks: results and thrown errors contain only fixed codes', () => {
  const envs = [
    base({ NEXT_PUBLIC_SUPABASE_URL: `https://${PROD}.supabase.co/${SENTINEL}` }),
    base({ NEXT_PUBLIC_SUPABASE_ANON_KEY: `${SENTINEL}.x` }),
    base({ NEXT_PUBLIC_SUPABASE_URL: `https://${SENTINEL}.example` }),
    base(),
  ];
  for (const env of envs) {
    const s = JSON.stringify(checkSupabaseTarget(env, { requireServiceKey: true }));
    for (const v of [SENTINEL, PREVIEW, PROD, OTHER]) assert.ok(!s.includes(v));
    try {
      requireSupabaseTarget(env, { requireServiceKey: true });
    } catch (e) {
      assert.match(String((e as Error).message), /^[A-Z_]+$/);
    }
  }
});

test('createAdminClient throws fixed code before createClient on a blocked preview target', async () => {
  const saved = { ...process.env };
  try {
    Object.assign(process.env, base({ NEXT_PUBLIC_SUPABASE_URL: `https://${PROD}.supabase.co` }));
    // admin.ts imports 'server-only'; run with --import ./src/lib/jury-product/server-only-test-hook.mjs
    const { createAdminClient } = await import('../supabase/admin');
    assert.throws(() => createAdminClient(), /^Error: BLOCKED_SUPABASE_PRODUCTION$/);
    process.env.NEXT_PUBLIC_SUPABASE_URL = URL_OK;
    process.env.SUPABASE_SERVICE_ROLE_KEY = ANON;
    assert.throws(() => createAdminClient(), /^Error: BLOCKED_SUPABASE_KEY_MISMATCH$/);
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE;
    assert.ok(createAdminClient()); // constructs only; no network call is made
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

function runBuild(env: Record<string, string | undefined>) {
  const clean: Record<string, string> = { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '' };
  for (const [k, v] of Object.entries(env)) if (v !== undefined) clean[k] = v;
  return spawnSync(process.execPath, [path.join('scripts', 'run-build.cjs')], { env: clean, encoding: 'utf8', timeout: 30000 });
}
const DB_OK = { DATABASE_URL: urls.pooler, DIRECT_URL: urls.direct };

test('run-build: preview supabase block exits 1 before migrate/next and prints only codes', () => {
  const r = runBuild({ ...base({ NEXT_PUBLIC_SUPABASE_URL: `https://${PROD}.supabase.co`, SUPABASE_SERVICE_ROLE_KEY: `${SENTINEL}` }), ...DB_OK });
  const out = `${r.stdout}${r.stderr}`;
  assert.equal(r.status, 1);
  assert.match(out, /\[build\] db target: DB_TARGET_OK/);
  assert.match(out, /\[build\] supabase target: BLOCKED_SUPABASE_PRODUCTION/);
  assert.doesNotMatch(out, /migrate policy|next build|prisma/i);
  for (const v of [SENTINEL, PREVIEW, PROD, 'supabase.co', 'postgres']) assert.ok(!out.includes(v));
});

test('run-build: undecodable present service key at build blocks', () => {
  const r = runBuild({ ...base({ SUPABASE_SERVICE_ROLE_KEY: `${SENTINEL}.invalid` }), ...DB_OK });
  const out = `${r.stdout}${r.stderr}`;
  assert.equal(r.status, 1);
  assert.match(out, /\[build\] supabase target: BLOCKED_SUPABASE_KEY_UNDECODABLE/);
  assert.doesNotMatch(out, /migrate policy/);
  assert.ok(!out.includes(SENTINEL));
});

test('run-build: DB block still stops first; supabase line not reached', () => {
  const r = runBuild({ ...base({ NEXT_PUBLIC_SUPABASE_URL: `https://${PROD}.supabase.co` }), DATABASE_URL: urls.prodPooler });
  const out = `${r.stdout}${r.stderr}`;
  assert.equal(r.status, 1);
  assert.match(out, /\[build\] db target: BLOCKED_DB_TARGET_PRODUCTION/);
  assert.doesNotMatch(out, /supabase target|migrate policy/);
});
