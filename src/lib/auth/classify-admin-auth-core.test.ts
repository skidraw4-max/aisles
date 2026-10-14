import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  AuthApiError,
  AuthRetryableFetchError,
  AuthSessionMissingError,
  AuthUnknownError,
} from '@supabase/supabase-js';
import { classifyAdminAuthCore, type ClassifyAdminAuthDeps } from './classify-admin-auth-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const SECRET = 'SENTINEL_SECRET_postgres://u:pw@db.example/x';

function run(over: Partial<ClassifyAdminAuthDeps>) {
  const lines: string[] = [];
  let roleCalls = 0;
  const deps: ClassifyAdminAuthDeps = {
    getUser: async () => ({ data: { user: { id: 'u1' } }, error: null }),
    findRole: async () => { roleCalls += 1; return 'ADMIN'; },
    log: (l) => lines.push(l),
    ...over,
  };
  return classifyAdminAuthCore(deps).then((r) => ({ r, lines, roleCalls }));
}
const authErr = (error: unknown) => ({ getUser: async () => ({ data: { user: null }, error }) });

test('classification: 11 cases (fixed codes, no text)', async () => {
  const cases: [string, Partial<ClassifyAdminAuthDeps>, unknown][] = [
    ['session missing', authErr(new AuthSessionMissingError()), 'UNAUTHORIZED'],
    ['403 bad_jwt', authErr(new AuthApiError(SECRET, 403, 'bad_jwt')), 'UNAUTHORIZED'],
    ['404 user_not_found', authErr(new AuthApiError(SECRET, 404, 'user_not_found')), 'UNAUTHORIZED'],
    ['retryable network (status 0)', authErr(new AuthRetryableFetchError(SECRET, 0)), 'AUTH_UNAVAILABLE'],
    ['retryable 503', authErr(new AuthRetryableFetchError(SECRET, 503)), 'AUTH_UNAVAILABLE'],
    ['AuthApiError 500', authErr(new AuthApiError(SECRET, 500, 'unexpected_failure')), 'AUTH_UNAVAILABLE'],
    ['ambiguous 4xx: 400 validation_failed', authErr(new AuthApiError(SECRET, 400, 'validation_failed')), 'AUTH_UNAVAILABLE'],
    ['unknown auth error', authErr(new AuthUnknownError(SECRET, new Error(SECRET))), 'AUTH_UNAVAILABLE'],
    ['getUser throws', { getUser: async () => { throw new Error(SECRET); } }, 'AUTH_UNAVAILABLE'],
    ['no user, no error', { getUser: async () => ({ data: { user: null }, error: null }) }, 'UNAUTHORIZED'],
    ['non-admin role', { findRole: async () => 'USER' }, 'FORBIDDEN'],
  ];
  assert.equal(cases.length, 11);
  for (const [name, over, code] of cases) {
    const { r, lines } = await run(over);
    assert.deepEqual(r, { ok: false, code }, name);
    const dump = JSON.stringify(r) + lines.join('\n');
    assert.ok(!dump.includes('SENTINEL'), `${name}: leaked`);
  }
  // Same allowlisted code with a non-allowlisted status is NOT a clear rejection.
  assert.deepEqual((await run(authErr(new AuthApiError('x', 429, 'bad_jwt')))).r, { ok: false, code: 'AUTH_UNAVAILABLE' });
  assert.deepEqual((await run({ findRole: async () => null })).r, { ok: false, code: 'FORBIDDEN' });
  assert.deepEqual((await run({})).r, { ok: true, userId: 'u1' });
});

test('Auth vs DB: auth outage never queries DB; DB outage is DB_UNAVAILABLE not FORBIDDEN', async () => {
  const a = await run(authErr(new AuthRetryableFetchError('x', 0)));
  assert.equal(a.roleCalls, 0);
  assert.deepEqual(a.r, { ok: false, code: 'AUTH_UNAVAILABLE' });
  assert.deepEqual(a.lines, ['[classifyAdminAuth] AUTH_UNAVAILABLE']);
  const d = await run({ findRole: async () => { throw new Error('db down'); } });
  assert.deepEqual(d.r, { ok: false, code: 'DB_UNAVAILABLE' });
  assert.deepEqual(d.lines, ['[classifyAdminAuth] DB_UNAVAILABLE']);
});

test('DB error text never leaks; Prisma code only when allowlisted', async () => {
  const boom = Object.assign(new Error(SECRET), { code: 'P1001', meta: { url: SECRET } });
  const captured: string[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => { captured.push(a.map(String).join(' ')); };
  try {
    const def = await classifyAdminAuthCore({
      getUser: async () => ({ data: { user: { id: 'u1' } }, error: null }),
      findRole: async () => { throw boom; },
    });
    assert.deepEqual(def, { ok: false, code: 'DB_UNAVAILABLE' });
    assert.deepEqual(captured, ['[classifyAdminAuth] DB_UNAVAILABLE']);
  } finally {
    console.error = orig;
  }
  const allowed = await run({ findRole: async () => { throw boom; }, logPrismaCodes: ['P1001'] });
  assert.deepEqual(allowed.lines, ['[classifyAdminAuth] DB_UNAVAILABLE P1001']);
  const bad = Object.assign(new Error(SECRET), { code: SECRET });
  const notAllowed = await run({ findRole: async () => { throw bad; }, logPrismaCodes: [SECRET] });
  assert.deepEqual(notAllowed.lines, ['[classifyAdminAuth] DB_UNAVAILABLE']);
});

test('core module has no Prisma/DB/network/cookie imports', () => {
  const src = readFileSync(path.join(here, 'classify-admin-auth-core.ts'), 'utf8');
  const imports = [...src.matchAll(/^\s*import\b[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
  assert.deepEqual(imports, ['@supabase/supabase-js']);
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(code, /@prisma|@\/lib\/prisma|['"]pg['"]|next\/headers|supabase\/server|@supabase\/ssr|createClient|node:(http|https|net|tls|dns)|fetch\s*\(|require\s*\(/);
});

test('require-admin.ts and its callers are unchanged; signature intact', () => {
  const callers = execFileSync('git', ['grep', '-l', 'requireAdminAction', '--', 'src'], { cwd: repo, encoding: 'utf8' })
    .split(/\r?\n/).filter((f) => f && !/preview-diagnostics|classify-admin-auth/.test(f));
  assert.ok(callers.includes('src/lib/auth/require-admin.ts'));
  assert.ok(callers.length >= 12);
  const diff = execFileSync('git', ['diff', 'HEAD', '--name-only', '--', ...callers], { cwd: repo, encoding: 'utf8' });
  assert.equal(diff.trim(), '');
  const ra = readFileSync(path.join(repo, 'src/lib/auth/require-admin.ts'), 'utf8');
  assert.match(ra, /export async function requireAdminAction\(\): Promise<AdminAuthSuccess \| AdminAuthFailure>/);
  assert.match(ra, /code: 'UNAUTHORIZED' \| 'FORBIDDEN';/);
});
